import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  ERRORES_DE_CATALOGO_POR_RESTRICCION,
  crearRepositoriosDeCatalogo,
  ocultoPor,
  type RepositoriosDeCatalogo,
} from "../../src/modulos/catalogo/publico";
import { cartaPublicaId } from "../../src/modulos/catalogo/dominio/identificadores";
import {
  LARGO_MAXIMO_DEL_LUGAR_DE_CARTA,
  LARGO_MAXIMO_DEL_NOMBRE_DE_CARTA,
  LARGO_MAXIMO_DEL_RUBRO_DE_CARTA,
} from "../../src/primitivas/texto/datos-de-carta-publica";
import { empresaId, personaId, sucursalId } from "../../src/primitivas/identificadores/marca";
import { productoDeBase } from "./catalogo-apoyo";
import { codigoAlAzar, empresaDeCarta, type EmpresaDeCarta } from "./carta-publica-apoyo";
import {
  codigoDe,
  correrEnParalelo,
  perdedorAceptable,
  repetirSiAgotada,
  agotadaEnElResultado,
} from "./concurrencia-apoyo";
import { comoEmpresa, crearEntornoDePrueba } from "./entorno";
import type { BaseDePruebas } from "./global";
import type { Resultado } from "../../src/primitivas/resultado/resultado";

/**
 * Los repositorios de la carta pública y del botón «Ocultar» (0043) con el rol REAL de la aplicación (RLS forzada, serializable con reintentos): lo que escriben,
 * lo que no pueden escribir, el aislamiento entre empresas, y la idempotencia y la concurrencia de cada alta y de cada cambio. Los casos de uso (T2) se arman
 * encima de estas garantías; acá se prueban solas.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const RONDAS = 8;

describe.skipIf(base === null)(
  "carta pública y «Ocultar»: repositorios contra la base real",
  () => {
    const entorno = crearEntornoDePrueba(base as BaseDePruebas, 10);
    let dueno: pg.Client;
    let barrera: (() => Promise<void>) | null = null;

    beforeAll(async () => {
      dueno = new pg.Client({ connectionString: (base as BaseDePruebas).dueno });
      await dueno.connect();
    });
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
    });

    const nuevaEmpresa = () => empresaDeCarta(entorno, dueno);
    /** Corre `trabajo` con los repositorios, en una transacción de la aplicación de ESA empresa y persona (la barrera, si está armada, espera adentro). */
    const como = <T>(e: EmpresaDeCarta, trabajo: (r: RepositoriosDeCatalogo) => Promise<T>) =>
      entorno.ejecutar(
        { contexto: comoEmpresa(empresaId(e.empresa), personaId(e.persona)) },
        async (tx) => {
          const repos = crearRepositoriosDeCatalogo(tx.db);
          if (barrera !== null) await barrera();
          return { ok: true as const, valor: await trabajo(repos) };
        },
      );
    const firme = <T>(e: EmpresaDeCarta, trabajo: (r: RepositoriosDeCatalogo) => Promise<T>) =>
      repetirSiAgotada(() => como(e, trabajo), { esAgotada: agotadaEnElResultado });
    const valor = <T, E>(r: Resultado<T, E>): T => {
      if (!r.ok) throw new Error(`se esperaba ok: ${JSON.stringify(r.error)}`);
      return r.valor;
    };
    const alta = (e: EmpresaDeCarta, sucursal: string, datos: Record<string, unknown> = {}) => ({
      id: cartaPublicaId(randomUUID()),
      sucursalId: sucursalId(sucursal),
      codigo: codigoAlAzar(),
      nombre: "Parador El Ensayo",
      rubro: null,
      lugar: null,
      estado: "FUERA_DE_LINEA" as const,
      creadoPor: personaId(e.persona),
      ...datos,
    });
    const restriccion = (r: Resultado<unknown, unknown>): string | null =>
      r.ok ? null : ((r.error as { restriccion?: string | null }).restriccion ?? null);
    const filas = async (tabla: string, e: EmpresaDeCarta) =>
      Number(
        (
          await dueno.query<{ n: string }>(
            `select count(*)::text as n from ${tabla} where empresa_id = $1`,
            [e.empresa],
          )
        ).rows[0]?.n,
      );

    describe("carta pública", () => {
      it("el alta nace como se pide, se lee por id y por sucursal, y el rol de la aplicación solo ve las cartas de SU empresa", async () => {
        const [a, b] = [await nuevaEmpresa(), await nuevaEmpresa()];
        const nueva = alta(a, a.s1, {
          nombre: "¿Querés papas?",
          rubro: "Parrilla",
          lugar: "Huinganco",
        });
        expect(
          valor(await como(a, (r) => r.cartasPublicas.insertar(empresaId(a.empresa), nueva))),
        ).toBe(true);
        const leida = valor(
          await como(a, (r) => r.cartasPublicas.obtener(empresaId(a.empresa), nueva.id)),
        );
        expect(leida).toEqual({
          id: nueva.id,
          empresaId: a.empresa,
          sucursalId: a.s1,
          codigo: nueva.codigo,
          nombre: "¿Querés papas?",
          rubro: "Parrilla",
          lugar: "Huinganco",
          estado: "FUERA_DE_LINEA",
          version: 1,
        });
        expect(
          valor(await como(a, (r) => r.cartasPublicas.deLaSucursal(empresaId(a.empresa), a.s1))),
        ).toEqual(leida);
        expect(
          valor(await como(a, (r) => r.cartasPublicas.deLaSucursal(empresaId(a.empresa), a.s2))),
        ).toBeNull();
        // La otra empresa no la ve, ni pidiéndola por empresa ajena (la RLS filtra por la del contexto, no por lo que mande quien llama).
        expect(
          valor(await como(b, (r) => r.cartasPublicas.obtener(empresaId(a.empresa), nueva.id))),
        ).toBeNull();
        expect(
          valor(await como(b, (r) => r.cartasPublicas.obtener(empresaId(b.empresa), nueva.id))),
        ).toBeNull();
        expect(
          valor(await como(b, (r) => r.cartasPublicas.bloquear(empresaId(b.empresa), nueva.id))),
        ).toBeNull();
        expect(
          valor(
            await como(a, (r) => r.cartasPublicas.obtener(empresaId(a.empresa), "no-es-un-uuid")),
          ),
        ).toBeNull();
      });

      it("la otra empresa no puede escribir con el id de empresa de la primera ni apuntar a su sucursal", async () => {
        const [a, b] = [await nuevaEmpresa(), await nuevaEmpresa()];
        const ajena = await como(b, (r) =>
          r.cartasPublicas.insertar(empresaId(a.empresa), alta(b, b.s1)),
        );
        expect(ajena.ok).toBe(false);
        const sucursalAjena = await como(b, (r) =>
          r.cartasPublicas.insertar(empresaId(b.empresa), alta(b, a.s1)),
        );
        expect(restriccion(sucursalAjena)).toBe("carta_publica_sucursal_fkey");
        expect(ERRORES_DE_CATALOGO_POR_RESTRICCION["carta_publica_sucursal_fkey"]).toBe(
          "SUCURSAL_NO_ENCONTRADA",
        );
        expect(await filas("carta_publica", a)).toBe(0);
        expect(await filas("carta_publica", b)).toBe(0);
      });

      it("el autor del alta es la persona del contexto: otra persona no se puede poner como autora", async () => {
        const a = await nuevaEmpresa();
        const otra = (await empresaDeCarta(entorno, dueno)).persona;
        const r = await como(a, (x) =>
          x.cartasPublicas.insertar(
            empresaId(a.empresa),
            alta(a, a.s1, { creadoPor: personaId(otra) }),
          ),
        );
        expect(r.ok).toBe(false);
        expect(await filas("carta_publica", a)).toBe(0);
      });

      it("idempotencia (clic doble): repetir el alta con el mismo id deja UNA fila y devuelve «ya estaba»", async () => {
        const a = await nuevaEmpresa();
        const nueva = alta(a, a.s1);
        expect(
          valor(await como(a, (r) => r.cartasPublicas.insertar(empresaId(a.empresa), nueva))),
        ).toBe(true);
        expect(
          valor(await como(a, (r) => r.cartasPublicas.insertar(empresaId(a.empresa), nueva))),
        ).toBe(false);
        expect(await filas("carta_publica", a)).toBe(1);
      });

      it("concurrencia (clic doble a la vez): el mismo alta simultáneo deja UNA fila, UN solo código y exactamente un «creó»", async () => {
        for (let ronda = 0; ronda < RONDAS; ronda++) {
          const a = await nuevaEmpresa();
          const nueva = alta(a, a.s1);
          const resultados = await correrEnParalelo(
            2,
            () => firme(a, (r) => r.cartasPublicas.insertar(empresaId(a.empresa), nueva)),
            (x) => {
              barrera = x;
            },
          );
          const valores = resultados.map((r) => valor(r));
          expect(valores.filter((v) => v).length, `ronda ${ronda}`).toBe(1);
          expect(await filas("carta_publica", a)).toBe(1);
        }
      });

      it("concurrencia (dos personas, dos ids): dos altas simultáneas para la MISMA sucursal dejan exactamente una; la otra es «la sucursal ya tiene carta»", async () => {
        for (let ronda = 0; ronda < RONDAS; ronda++) {
          const a = await nuevaEmpresa();
          const resultados = await correrEnParalelo(
            2,
            () => como(a, (r) => r.cartasPublicas.insertar(empresaId(a.empresa), alta(a, a.s1))),
            (x) => {
              barrera = x;
            },
          );
          perdedorAceptable(resultados, { esperados: ["Unicidad"], contexto: `ronda ${ronda}` });
          for (const r of resultados)
            if (!r.ok && codigoDe(r) === "Unicidad")
              expect(restriccion(r)).toBe("carta_publica_sucursal_uk");
          expect(await filas("carta_publica", a)).toBe(1);
        }
      });

      it("el código es único en TODA la plataforma: el mismo código en otra empresa se rechaza con su error", async () => {
        const [a, b] = [await nuevaEmpresa(), await nuevaEmpresa()];
        const codigo = codigoAlAzar();
        valor(
          await como(a, (r) =>
            r.cartasPublicas.insertar(empresaId(a.empresa), alta(a, a.s1, { codigo })),
          ),
        );
        const repetido = await como(b, (r) =>
          r.cartasPublicas.insertar(empresaId(b.empresa), alta(b, b.s1, { codigo })),
        );
        expect(restriccion(repetido)).toBe("carta_publica_codigo_uk");
        expect(ERRORES_DE_CATALOGO_POR_RESTRICCION["carta_publica_codigo_uk"]).toBe(
          "CODIGO_DE_CARTA_REPETIDO",
        );
        expect(await filas("carta_publica", b)).toBe(0);
      });

      it("actualizar con control de versión: la versión vieja no pisa, y el código y la sucursal quedan como estaban", async () => {
        const a = await nuevaEmpresa();
        const nueva = alta(a, a.s1);
        valor(await como(a, (r) => r.cartasPublicas.insertar(empresaId(a.empresa), nueva)));
        const cambios = {
          nombre: "Otro nombre",
          rubro: "Café",
          lugar: null,
          estado: "EN_LINEA" as const,
        };
        const editada = valor(
          await como(a, (r) =>
            r.cartasPublicas.actualizar(empresaId(a.empresa), nueva.id, 1, cambios),
          ),
        );
        expect(editada).toMatchObject({
          ...cambios,
          version: 2,
          codigo: nueva.codigo,
          sucursalId: a.s1,
        });
        expect(
          valor(
            await como(a, (r) =>
              r.cartasPublicas.actualizar(empresaId(a.empresa), nueva.id, 1, {
                ...cambios,
                nombre: "Pisada",
              }),
            ),
          ),
        ).toBeNull();
        expect(
          valor(
            await como(a, (r) =>
              r.cartasPublicas.actualizar(empresaId(a.empresa), "no-es-un-uuid", 1, cambios),
            ),
          ),
        ).toBeNull();
        expect(
          valor(await como(a, (r) => r.cartasPublicas.obtener(empresaId(a.empresa), nueva.id)))
            ?.nombre,
        ).toBe("Otro nombre");
      });

      it("concurrencia (editar a la vez): con la misma versión, una gana y la otra recibe «versión vieja»; nunca se mezclan", async () => {
        for (let ronda = 0; ronda < RONDAS; ronda++) {
          const a = await nuevaEmpresa();
          const nueva = alta(a, a.s1);
          valor(await como(a, (r) => r.cartasPublicas.insertar(empresaId(a.empresa), nueva)));
          const nombres = ["Uno", "Dos"];
          const resultados = await correrEnParalelo(
            2,
            (i) =>
              como(a, (r) =>
                r.cartasPublicas.actualizar(empresaId(a.empresa), nueva.id, 1, {
                  nombre: nombres[i] as string,
                  rubro: null,
                  lugar: null,
                  estado: "EN_LINEA",
                }),
              ),
            (x) => {
              barrera = x;
            },
          );
          const ganadores = resultados.filter((r) => r.ok && r.valor !== null);
          expect(ganadores.length, `ronda ${ronda}`).toBe(1);
          const guardada = valor(
            await como(a, (r) => r.cartasPublicas.obtener(empresaId(a.empresa), nueva.id)),
          );
          expect(guardada?.version).toBe(2);
          expect(nombres).toContain(guardada?.nombre);
        }
      });

      it("los topes de la base son los de la primitiva (una sola regla, copiada con prueba): el exacto entra y uno más no, y `<` no", async () => {
        const a = await nuevaEmpresa();
        const intentar = (datos: Record<string, unknown>, sucursal: string) =>
          como(a, (r) => r.cartasPublicas.insertar(empresaId(a.empresa), alta(a, sucursal, datos)));
        expect(
          restriccion(
            await intentar({ nombre: "a".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_CARTA + 1) }, a.s1),
          ),
        ).toBe("carta_publica_nombre_ck");
        expect(
          restriccion(
            await intentar({ rubro: "a".repeat(LARGO_MAXIMO_DEL_RUBRO_DE_CARTA + 1) }, a.s1),
          ),
        ).toBe("carta_publica_rubro_ck");
        expect(
          restriccion(
            await intentar({ lugar: "a".repeat(LARGO_MAXIMO_DEL_LUGAR_DE_CARTA + 1) }, a.s1),
          ),
        ).toBe("carta_publica_lugar_ck");
        expect(restriccion(await intentar({ nombre: "<b>x</b>" }, a.s1))).toBe(
          "carta_publica_nombre_ck",
        );
        expect(
          valor(
            await intentar(
              {
                nombre: "a".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_CARTA),
                rubro: "a".repeat(LARGO_MAXIMO_DEL_RUBRO_DE_CARTA),
                lugar: "a".repeat(LARGO_MAXIMO_DEL_LUGAR_DE_CARTA),
              },
              a.s1,
            ),
          ),
        ).toBe(true);
      });
    });

    describe("botón «Ocultar» (disponibilidad de producto)", () => {
      const fijar = (
        e: EmpresaDeCarta,
        producto: string,
        sucursal: string | null,
        oculto: boolean,
        persona = e.persona,
      ) =>
        firme(e, (r) =>
          r.disponibilidadDeProductos.fijar(empresaId(e.empresa), {
            productoId: producto,
            sucursalId: sucursal === null ? null : sucursalId(sucursal),
            oculto,
            actualizadoPor: personaId(persona),
            actualizadoEn: new Date("2026-11-12T15:00:00Z"),
          }),
        );

      it("fija un ESTADO (no alterna): ocultar, mostrar y repetir dejan una sola fila por alcance, con el reloj de quien llama", async () => {
        const a = await nuevaEmpresa();
        const primera = valor(await fijar(a, a.producto, a.s1, true));
        expect(primera).toMatchObject({
          oculto: true,
          version: 1,
          sucursalId: a.s1,
          productoId: a.producto,
        });
        expect(primera.actualizadoEn.toISOString()).toBe("2026-11-12T15:00:00.000Z");
        expect(valor(await fijar(a, a.producto, a.s1, true))).toMatchObject({ oculto: true });
        expect(valor(await fijar(a, a.producto, a.s1, false))).toMatchObject({ oculto: false });
        expect(valor(await fijar(a, a.producto, a.s1, false))).toMatchObject({ oculto: false });
        expect(await filas("disponibilidad_de_producto", a)).toBe(1);
        // El alcance de la empresa es otra fila, y el local no la pisa.
        valor(await fijar(a, a.producto, null, true));
        expect(await filas("disponibilidad_de_producto", a)).toBe(2);
        const alcanzan = valor(
          await como(a, (r) =>
            r.disponibilidadDeProductos.queAlcanzanAlLocal(empresaId(a.empresa), a.producto, a.s1),
          ),
        );
        expect(ocultoPor(alcanzan, sucursalId(a.s1))).toBe("EMPRESA");
        valor(await fijar(a, a.producto, null, false));
        expect(
          ocultoPor(
            valor(
              await como(a, (r) =>
                r.disponibilidadDeProductos.queAlcanzanAlLocal(
                  empresaId(a.empresa),
                  a.producto,
                  a.s1,
                ),
              ),
            ),
            sucursalId(a.s1),
          ),
        ).toBeNull();
      });

      it("`queAlcanzanAlLocal` devuelve la fila de la empresa y la del local, nunca las de otros locales", async () => {
        const a = await nuevaEmpresa();
        valor(await fijar(a, a.producto, a.s2, true));
        const delLocal1 = valor(
          await como(a, (r) =>
            r.disponibilidadDeProductos.queAlcanzanAlLocal(empresaId(a.empresa), a.producto, a.s1),
          ),
        );
        expect(delLocal1).toEqual([]);
        expect(ocultoPor(delLocal1, sucursalId(a.s1))).toBeNull();
        const todas = valor(
          await como(a, (r) =>
            r.disponibilidadDeProductos.delProducto(empresaId(a.empresa), a.producto),
          ),
        );
        expect(todas).toHaveLength(1);
        expect(ocultoPor(todas, sucursalId(a.s2))).toBe("SUCURSAL");
        expect(
          valor(
            await como(a, (r) =>
              r.disponibilidadDeProductos.obtener(empresaId(a.empresa), a.producto, a.s2),
            ),
          )?.oculto,
        ).toBe(true);
        expect(
          valor(
            await como(a, (r) =>
              r.disponibilidadDeProductos.bloquear(empresaId(a.empresa), a.producto, null),
            ),
          ),
        ).toBeNull();
        expect(
          valor(
            await como(a, (r) =>
              r.disponibilidadDeProductos.delProducto(empresaId(a.empresa), "no-es-un-uuid"),
            ),
          ),
        ).toEqual([]);
      });

      it("concurrencia (apretar a la vez): dos «ocultar» simultáneos dejan UNA fila; y con valores contrarios queda uno de los dos, nunca dos filas ni un error", async () => {
        for (let ronda = 0; ronda < RONDAS; ronda++) {
          const a = await nuevaEmpresa();
          const iguales = await correrEnParalelo(
            2,
            () => fijar(a, a.producto, a.s1, true),
            (x) => {
              barrera = x;
            },
          );
          expect(
            iguales.every((r) => r.ok),
            `ronda ${ronda}`,
          ).toBe(true);
          expect(await filas("disponibilidad_de_producto", a)).toBe(1);
          const contrarios = await correrEnParalelo(
            2,
            (i) => fijar(a, a.producto, null, i === 0),
            (x) => {
              barrera = x;
            },
          );
          expect(
            contrarios.every((r) => r.ok),
            `ronda ${ronda}`,
          ).toBe(true);
          expect(await filas("disponibilidad_de_producto", a)).toBe(2);
          const { rows } = await dueno.query<{ n: string }>(
            "select count(*)::text as n from disponibilidad_de_producto where empresa_id = $1 and sucursal_id is null",
            [a.empresa],
          );
          expect(rows[0]?.n).toBe("1");
        }
      });

      it("aislamiento: otra empresa no la ve ni puede ocultar un producto ajeno; el autor es el de la sesión", async () => {
        const [a, b] = [await nuevaEmpresa(), await nuevaEmpresa()];
        valor(await fijar(a, a.producto, a.s1, true));
        expect(
          valor(
            await como(b, (r) =>
              r.disponibilidadDeProductos.delProducto(empresaId(a.empresa), a.producto),
            ),
          ),
        ).toEqual([]);
        const ajeno = await como(b, (r) =>
          r.disponibilidadDeProductos.fijar(empresaId(b.empresa), {
            productoId: a.producto,
            sucursalId: null,
            oculto: true,
            actualizadoPor: personaId(b.persona),
            actualizadoEn: new Date(),
          }),
        );
        expect(restriccion(ajeno)).toBe("disponibilidad_producto_fkey");
        expect(ERRORES_DE_CATALOGO_POR_RESTRICCION["disponibilidad_producto_fkey"]).toBe(
          "PRODUCTO_NO_ENCONTRADO",
        );
        const sucursalAjena = await como(b, (r) =>
          r.disponibilidadDeProductos.fijar(empresaId(b.empresa), {
            productoId: b.producto,
            sucursalId: sucursalId(a.s1),
            oculto: true,
            actualizadoPor: personaId(b.persona),
            actualizadoEn: new Date(),
          }),
        );
        expect(restriccion(sucursalAjena)).toBe("disponibilidad_sucursal_fkey");
        const otraPersona = await fijar(b, b.producto, null, true, a.persona).catch(
          (e: unknown) => e,
        );
        expect(
          otraPersona instanceof Error ||
            (typeof otraPersona === "object" &&
              otraPersona !== null &&
              "ok" in otraPersona &&
              !otraPersona.ok),
        ).toBe(true);
        expect(await filas("disponibilidad_de_producto", b)).toBe(0);
        expect(await filas("disponibilidad_de_producto", a)).toBe(1);
        const otro = await productoDeBase(dueno, a.empresa);
        expect(
          valor(
            await como(a, (r) =>
              r.disponibilidadDeProductos.delProducto(empresaId(a.empresa), otro),
            ),
          ),
        ).toEqual([]);
      });
    });
  },
);
