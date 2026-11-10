import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { RepositorioDeListas } from "../../src/modulos/listas/publico";
import type { CasosDeUsoDeListas } from "../../src/plataforma/casos-de-uso/listas-del-sistema";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { crearBarrera, crearBaseAparte } from "./entorno";
import {
  crearCasosDeListas,
  crearEntornoDeListas,
  huellaDeListas,
  valorPorNombre,
  valoresGuardados,
  type TxDeListasDePrueba,
} from "./listas-apoyo";
import { auditoriaDePlataformaDe, clave, comoAdminAhora, exito } from "./marcas-y-planes-apoyo";

/**
 * Concurrencia de las listas del sistema (e3 §3.7) contra Postgres real y con barrera: todas las transacciones LEEN antes de que
 * ninguna escriba, así que las carreras ocurren de verdad (no por casualidad de tiempos). Cada prueba se repite `VUELTAS` veces con
 * nombres nuevos. Base propia: SERIALIZABLE aborta por falsos positivos si otros archivos escriben las mismas tablas en paralelo.
 *
 * Lo que se prueba: la única por nombre es la que decide la carrera de `agregar` (`ON CONFLICT DO NOTHING` sin objetivo: con
 * `ON CONFLICT (id)` solo se cubría ESE índice y el segundo agregado explotaba con un error de la base); dos cambios desde la misma
 * versión dejan uno; un doble clic (misma clave) es uno solo.
 */

const base = inject("baseDePruebas");
const VUELTAS = 60;
const MARCAS = "MARCAS_DE_TARJETA";

const errores = (rs: ReadonlyArray<Resultado<unknown, unknown>>) =>
  rs.flatMap((r) => (r.ok ? [] : [r.error]));
const exitos = <T>(rs: ReadonlyArray<Resultado<T, unknown>>) =>
  rs.flatMap((r) => (r.ok ? [r.valor] : []));

describe.skipIf(base === null)("listas del sistema: concurrencia", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entornoLibre: TransaccionesDePostgres<TxDeListasDePrueba>;
  let casosLibres: CasosDeUsoDeListas;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entornoLibre = crearEntornoDeListas(propia.base, 8);
    casosLibres = crearCasosDeListas(entornoLibre);
  });
  afterAll(async () => {
    await dueno.end();
    await entornoLibre.cerrar();
    await propia.destruir();
  });

  /** Envuelve los métodos de lectura del repositorio para esperar en la barrera DESPUÉS de leer. */
  function despuesDeLeer(
    repo: RepositorioDeListas,
    metodos: readonly (keyof RepositorioDeListas)[],
    barrera: () => Promise<void>,
  ): RepositorioDeListas {
    const envuelto = { ...repo } as Record<string, unknown>;
    for (const metodo of metodos) {
      const original = Reflect.get(repo, metodo) as (...a: unknown[]) => Promise<unknown>;
      envuelto[metodo] = async (...a: unknown[]) => {
        const r = await original.call(repo, ...a);
        await barrera();
        return r;
      };
    }
    return envuelto as unknown as RepositorioDeListas;
  }

  /** Casos cuyas transacciones esperan en una barrera DESPUÉS de leer lo que nombran y ANTES de escribir. */
  function conBarrera(participantes: number, lecturas: readonly (keyof RepositorioDeListas)[]) {
    const barrera = crearBarrera(participantes);
    const entorno = crearEntornoDeListas(propia.base, participantes + 2, (tx) => ({
      ...tx,
      listas: despuesDeLeer(tx.listas, lecturas, barrera),
    }));
    return { casos: crearCasosDeListas(entorno), cerrar: () => entorno.cerrar() };
  }

  async function enCarrera<T = never>(
    participantes: number,
    lecturas: readonly (keyof RepositorioDeListas)[],
    pedidos: ReadonlyArray<(casos: CasosDeUsoDeListas) => Promise<Resultado<unknown, unknown>>>,
  ): Promise<Array<Resultado<T, unknown>>> {
    const { casos, cerrar } = conBarrera(participantes, lecturas);
    try {
      return (await Promise.all(pedidos.map((p) => p(casos)))) as Array<Resultado<T, unknown>>;
    } finally {
      await cerrar();
    }
  }

  const agregar = (casos: CasosDeUsoDeListas, nombre: string, claveDeIdempotencia = clave()) =>
    casos.agregarValorDeLista(comoAdminAhora(), {
      claveDeIdempotencia,
      lista: MARCAS,
      nombre,
    });
  const unico = (prefijo: string, vuelta: number) => `${prefijo} ${vuelta}`;
  const cuantos = async (nombre: string) =>
    (await valoresGuardados(dueno, MARCAS)).filter(
      (v) => v.nombre.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "") === nombre,
    ).length;

  it("dos personas agregan el MISMO valor a la vez (distinta clave): queda uno y el segundo recibe VALOR_DUPLICADO", async () => {
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      const nombre = unico("Tarjeta Gemela", vuelta);
      const rs = await enCarrera<{ valorId: string }>(
        2,
        ["porNombre"],
        [(c) => agregar(c, nombre), (c) => agregar(c, nombre)],
      );
      expect(exitos(rs), `vuelta ${vuelta}`).toHaveLength(1);
      expect(errores(rs), `vuelta ${vuelta}`).toEqual(["VALOR_DUPLICADO"]);
      expect(
        (await valoresGuardados(dueno, MARCAS)).filter((v) => v.nombre === nombre),
      ).toHaveLength(1);
      const [ganador] = exitos(rs);
      expect(
        await auditoriaDePlataformaDe(dueno, "valor_de_lista", ganador?.valorId as string),
      ).toHaveLength(1);
    }
  });

  it("el repositorio sin releer y con un aislamiento menor (READ COMMITTED): el segundo `agregar` no lanza, devuelve null y el valor queda uno", async () => {
    // Lo que protege `ON CONFLICT DO NOTHING` SIN objetivo: con `ON CONFLICT (id)` la carrera de la única por nombre sale como un error
    // de la base. Bajo SERIALIZABLE y releyendo antes, el caso de uso lo cubre además por el reintento; acá no hay nada de eso.
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      const nombre = unico("Tarjeta Sin Releer", vuelta);
      const barrera = crearBarrera(2);
      const agregarDirecto = () =>
        entornoLibre.ejecutar(
          { contexto: comoAdminAhora(), aislamiento: "read committed" },
          async (tx) => {
            await barrera();
            return { ok: true as const, valor: await tx.listas.agregar(MARCAS, nombre) };
          },
        );
      const rs = await Promise.all([agregarDirecto(), agregarDirecto()]);
      expect(errores(rs), `vuelta ${vuelta}`).toEqual([]);
      const filas = exitos(rs).map((fila) => fila !== null);
      expect(filas.filter(Boolean), `vuelta ${vuelta}`).toHaveLength(1);
      expect(await cuantos(nombre.toLowerCase())).toBe(1);
    }
  });

  it("con distinta capitalización o acento a la vez: queda uno (la única es sin distinguir mayúsculas ni acentos)", async () => {
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      const base = `Débito Único ${vuelta}`;
      const rs = await enCarrera(
        3,
        ["porNombre"],
        [
          (c) => agregar(c, base),
          (c) => agregar(c, base.toUpperCase()),
          (c) => agregar(c, `debito unico ${vuelta}`),
        ],
      );
      expect(exitos(rs), `vuelta ${vuelta}`).toHaveLength(1);
      expect(errores(rs), `vuelta ${vuelta}`).toEqual(["VALOR_DUPLICADO", "VALOR_DUPLICADO"]);
      expect(await cuantos(`debito unico ${vuelta}`)).toBe(1);
    }
  });

  it("muchos a la vez con el mismo nombre: uno gana, todos los demás VALOR_DUPLICADO y ningún error de la base", async () => {
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      const nombre = unico("Tarjeta Multitud", vuelta);
      const rs = await enCarrera(
        6,
        ["porNombre"],
        Array.from({ length: 6 }, () => (c: CasosDeUsoDeListas) => agregar(c, nombre)),
      );
      expect(exitos(rs), `vuelta ${vuelta}`).toHaveLength(1);
      expect(errores(rs), `vuelta ${vuelta}`).toEqual(Array(5).fill("VALOR_DUPLICADO"));
      expect(await cuantos(nombre.toLowerCase())).toBe(1);
    }
  });

  it("doble clic (la MISMA clave a la vez): se agrega una sola vez y las dos respuestas son el mismo valor", async () => {
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      const nombre = unico("Tarjeta Doble Clic", vuelta);
      const claveDeIdempotencia = clave();
      const antes = await huellaDeListas(dueno);
      const rs = await enCarrera<{ valorId: string }>(
        2,
        ["porNombre"],
        [
          (c) => agregar(c, nombre, claveDeIdempotencia),
          (c) => agregar(c, nombre, claveDeIdempotencia),
        ],
      );
      expect(errores(rs), `vuelta ${vuelta}`).toEqual([]);
      const [a, b] = exitos(rs);
      expect(a, `vuelta ${vuelta}`).toEqual(b);
      const despues = await huellaDeListas(dueno);
      expect(despues, `vuelta ${vuelta}`).toEqual({
        valores: antes.valores + 1,
        cambios: antes.cambios + 1,
        auditoria: antes.auditoria + 1,
        claves: antes.claves + 1,
      });
      expect((await valorPorNombre(dueno, MARCAS, nombre)).id).toBe(a?.valorId);
    }
  });

  it("dos correcciones desde la MISMA versión (con nombres distintos): una gana y la otra es VERSION_DESACTUALIZADA", async () => {
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      exito(await agregar(casosLibres, unico("Tarjeta Carrera", vuelta)));
      const v = await valorPorNombre(dueno, MARCAS, unico("Tarjeta Carrera", vuelta));
      const rs = await enCarrera(
        2,
        ["porId"],
        [
          (c) =>
            c.corregirNombreDeValor(comoAdminAhora(), {
              claveDeIdempotencia: clave(),
              valorId: v.id,
              nombre: unico("Carrera Uno", vuelta),
              versionEsperada: v.version,
            }),
          (c) =>
            c.corregirNombreDeValor(comoAdminAhora(), {
              claveDeIdempotencia: clave(),
              valorId: v.id,
              nombre: unico("Carrera Dos", vuelta),
              versionEsperada: v.version,
            }),
        ],
      );
      expect(exitos(rs), `vuelta ${vuelta}`).toHaveLength(1);
      expect(errores(rs), `vuelta ${vuelta}`).toEqual(["VERSION_DESACTUALIZADA"]);
      const actual = (await valoresGuardados(dueno, MARCAS)).find((x) => x.id === v.id);
      expect(actual?.version, `vuelta ${vuelta}`).toBe(v.version + 1);
      const renombres = (await auditoriaDePlataformaDe(dueno, "valor_de_lista", v.id)).filter(
        (c) => c.accion === "VALOR_DE_LISTA_RENOMBRADO",
      );
      expect(renombres, `vuelta ${vuelta}`).toHaveLength(1);
    }
  });

  it("dos correcciones desde la misma versión al MISMO nombre: una gana y la otra es VERSION_DESACTUALIZADA o VALOR_DUPLICADO, nunca un error de la base", async () => {
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      exito(await agregar(casosLibres, unico("Tarjeta Mismo Destino", vuelta)));
      const v = await valorPorNombre(dueno, MARCAS, unico("Tarjeta Mismo Destino", vuelta));
      const destino = unico("Destino Comun", vuelta);
      const corregir = (c: CasosDeUsoDeListas) =>
        c.corregirNombreDeValor(comoAdminAhora(), {
          claveDeIdempotencia: clave(),
          valorId: v.id,
          nombre: destino,
          versionEsperada: v.version,
        });
      const rs = await enCarrera(2, ["porId"], [corregir, corregir]);
      expect(exitos(rs), `vuelta ${vuelta}`).toHaveLength(1);
      expect(errores(rs)[0], `vuelta ${vuelta}`).toBe("VERSION_DESACTUALIZADA");
      expect(await cuantos(destino.toLowerCase())).toBe(1);
    }
  });

  it("dos valores que se renombran a la vez al MISMO nombre: queda uno con ese nombre y el otro VALOR_DUPLICADO", async () => {
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      exito(await agregar(casosLibres, unico("Tarjeta Par A", vuelta)));
      exito(await agregar(casosLibres, unico("Tarjeta Par B", vuelta)));
      const a = await valorPorNombre(dueno, MARCAS, unico("Tarjeta Par A", vuelta));
      const b = await valorPorNombre(dueno, MARCAS, unico("Tarjeta Par B", vuelta));
      const destino = unico("Par Destino", vuelta);
      const rs = await enCarrera(
        2,
        ["porId"],
        [a, b].map(
          (v) => (c: CasosDeUsoDeListas) =>
            c.corregirNombreDeValor(comoAdminAhora(), {
              claveDeIdempotencia: clave(),
              valorId: v.id,
              nombre: destino,
              versionEsperada: v.version,
            }),
        ),
      );
      expect(exitos(rs), `vuelta ${vuelta}`).toHaveLength(1);
      expect(errores(rs), `vuelta ${vuelta}`).toEqual(["VALOR_DUPLICADO"]);
      expect(await cuantos(destino.toLowerCase())).toBe(1);
    }
  });

  it("dos desactivar a la vez (otra clave cada uno): el valor queda inactivo, la versión sube UNA vez y se audita UNA vez", async () => {
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      exito(await agregar(casosLibres, unico("Tarjeta Apagar", vuelta)));
      const v = await valorPorNombre(dueno, MARCAS, unico("Tarjeta Apagar", vuelta));
      const rs = await enCarrera<{ yaEstabaInactivo: boolean }>(
        2,
        ["porId"],
        [
          (c) =>
            c.desactivarValorDeLista(comoAdminAhora(), {
              claveDeIdempotencia: clave(),
              valorId: v.id,
              versionEsperada: v.version,
            }),
          (c) =>
            c.desactivarValorDeLista(comoAdminAhora(), {
              claveDeIdempotencia: clave(),
              valorId: v.id,
              versionEsperada: v.version,
            }),
        ],
      );
      expect(errores(rs), `vuelta ${vuelta}`).toEqual([]);
      expect(
        exitos(rs)
          .map((s) => s.yaEstabaInactivo)
          .sort(),
        `vuelta ${vuelta}`,
      ).toEqual([false, true]);
      const actual = (await valoresGuardados(dueno, MARCAS)).find((x) => x.id === v.id);
      expect(actual, `vuelta ${vuelta}`).toMatchObject({ activo: false, version: v.version + 1 });
      const constancias = (await auditoriaDePlataformaDe(dueno, "valor_de_lista", v.id)).filter(
        (c) => c.accion === "VALOR_DE_LISTA_DESACTIVADO",
      );
      expect(constancias, `vuelta ${vuelta}`).toHaveLength(1);
    }
  });

  it("doble clic en desactivar (la MISMA clave a la vez): una sola vez", async () => {
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      exito(await agregar(casosLibres, unico("Tarjeta Doble Apagar", vuelta)));
      const v = await valorPorNombre(dueno, MARCAS, unico("Tarjeta Doble Apagar", vuelta));
      const claveDeIdempotencia = clave();
      const desactivar = (c: CasosDeUsoDeListas) =>
        c.desactivarValorDeLista(comoAdminAhora(), {
          claveDeIdempotencia,
          valorId: v.id,
          versionEsperada: v.version,
        });
      const rs = await enCarrera(2, ["porId"], [desactivar, desactivar]);
      expect(errores(rs), `vuelta ${vuelta}`).toEqual([]);
      expect((await valoresGuardados(dueno, MARCAS)).find((x) => x.id === v.id)).toMatchObject({
        activo: false,
        version: v.version + 1,
      });
      expect(
        (await auditoriaDePlataformaDe(dueno, "valor_de_lista", v.id)).filter(
          (c) => c.accion === "VALOR_DE_LISTA_DESACTIVADO",
        ),
        `vuelta ${vuelta}`,
      ).toHaveLength(1);
    }
  });

  it("corregir y desactivar desde la misma versión a la vez: uno gana y el otro es VERSION_DESACTUALIZADA", async () => {
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      exito(await agregar(casosLibres, unico("Tarjeta Cruce", vuelta)));
      const v = await valorPorNombre(dueno, MARCAS, unico("Tarjeta Cruce", vuelta));
      const rs = await enCarrera(
        2,
        ["porId"],
        [
          (c) =>
            c.corregirNombreDeValor(comoAdminAhora(), {
              claveDeIdempotencia: clave(),
              valorId: v.id,
              nombre: unico("Cruce Nuevo", vuelta),
              versionEsperada: v.version,
            }),
          (c) =>
            c.desactivarValorDeLista(comoAdminAhora(), {
              claveDeIdempotencia: clave(),
              valorId: v.id,
              versionEsperada: v.version,
            }),
        ],
      );
      expect(exitos(rs), `vuelta ${vuelta}`).toHaveLength(1);
      expect(errores(rs), `vuelta ${vuelta}`).toEqual(["VERSION_DESACTUALIZADA"]);
      const actual = (await valoresGuardados(dueno, MARCAS)).find((x) => x.id === v.id);
      expect(actual?.version, `vuelta ${vuelta}`).toBe(v.version + 1);
    }
  });
});
