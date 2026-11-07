import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { ok } from "../../src/primitivas/resultado/resultado";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { personaId, type PersonaId } from "../../src/primitivas/identificadores/marca";
import {
  comoEmpresa,
  comoPlataforma,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  type EmpresaDePrueba,
} from "./entorno";
import { contarSentencias, type ContadorDeSentencias } from "./contar-sentencias";
import { crearMembresiaDeBase, crearPersonaDeBase } from "./fixtures-identidad";

/**
 * Las lecturas de UN pedido comparten una transacción de solo lectura (`conLecturasCompartidas`) y los permisos que lee el guard se
 * resuelven una vez. Lo que NO puede pasar: que un pedido vea lo de otro, que una escritura o una lectura de otro contexto entre a la
 * transacción de solo lectura, que una falla de la base deje a las lecturas siguientes sobre una transacción abortada, ni que quede una
 * conexión abierta cuando el pedido terminó. Previene: 40 sentencias por pantalla (un viaje a la base cada una) sin cambiar quién puede qué.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("lecturas compartidas por pedido", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  let a: EmpresaDePrueba;
  let b: EmpresaDePrueba;
  /** Cada sentencia que mandó la aplicación a la base, en orden. */
  /** Cuenta lo que mandan TODOS los clientes de este proceso, menos el del dueño (preparación y verificaciones de la prueba). */
  let contador: ContadorDeSentencias | null = null;
  const empezar = () => contador?.reiniciar();
  const sentencias = () => contador?.sentencias() ?? [];
  const cuantas = (patron: RegExp) => sentencias().filter((s) => patron.test(s)).length;
  const BEGIN = /^(begin|start transaction)/i;
  const COMMIT = /^commit/i;
  const CONTEXTO = /set_config\('app\.ctx'/;

  /** La empresa que ve la transacción en curso (la fija el contexto firmado). */
  async function leerEmpresa(contexto: ContextoOperativo) {
    const r = await entorno.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async ({ db }) => {
        const { rows } = await sql<{ e: string }>`select app_empresa_id()::text as e`.execute(db);
        return ok(rows[0]?.e ?? "");
      },
    );
    if (!r.ok) throw new Error(`falló la lectura: ${JSON.stringify(r.error)}`);
    return r.valor;
  }
  const conectados = async (): Promise<{ enTransaccion: number }> => {
    const { rows } = await dueno.query<{ n: string }>(
      `select count(*)::text as n from pg_stat_activity
        where datname = current_database() and state like 'idle in transaction%' and pid <> pg_backend_pid()`,
    );
    return { enTransaccion: Number(rows[0]?.n ?? 0) };
  };
  const nuevoContexto = (e: EmpresaDePrueba, persona: PersonaId | null = null) =>
    comoEmpresa(e.empresa, persona);

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 5);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    a = await crearEmpresaActiva(entorno);
    b = await crearEmpresaActiva(entorno);
    contador = contarSentencias(dueno);
  });
  afterAll(async () => {
    contador?.detener();
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  it("varias lecturas del mismo contexto usan UNA transacción: un BEGIN, un contexto firmado y un COMMIT", async () => {
    const contexto = nuevoContexto(a);
    empezar();
    const vistas = await entorno.conLecturasCompartidas(contexto, async () => [
      await leerEmpresa(contexto),
      await leerEmpresa(contexto),
      await leerEmpresa(contexto),
    ]);
    expect(vistas).toEqual([a.empresa, a.empresa, a.empresa]);
    expect(cuantas(BEGIN)).toBe(1);
    expect(cuantas(CONTEXTO)).toBe(1);
    expect(cuantas(COMMIT)).toBe(1);
    // Y sin la unidad, cada una abre la suya (así era antes).
    empezar();
    await leerEmpresa(contexto);
    await leerEmpresa(contexto);
    expect(cuantas(BEGIN)).toBe(2);
    expect(cuantas(CONTEXTO)).toBe(2);
  });

  it("sin lecturas no abre nada: una pantalla que no consulta no cuesta ni un BEGIN", async () => {
    empezar();
    await entorno.conLecturasCompartidas(nuevoContexto(a), () => Promise.resolve(1));
    expect(sentencias()).toEqual([]);
  });

  it("al terminar el pedido la unidad se cierra: ninguna conexión queda en transacción y la lectura siguiente ya no se une", async () => {
    const contexto = nuevoContexto(a);
    await entorno.conLecturasCompartidas(contexto, () => leerEmpresa(contexto));
    expect((await conectados()).enTransaccion).toBe(0);
    empezar();
    await leerEmpresa(contexto);
    expect(cuantas(BEGIN)).toBe(1);
    expect(cuantas(COMMIT)).toBe(1);
  });

  it("si el trabajo del pedido falla, la unidad se suelta igual y el error es el del trabajo", async () => {
    const contexto = nuevoContexto(a);
    await expect(
      entorno.conLecturasCompartidas(contexto, async () => {
        await leerEmpresa(contexto);
        throw new Error("falla de la pantalla");
      }),
    ).rejects.toThrow("falla de la pantalla");
    expect((await conectados()).enTransaccion).toBe(0);
  });

  it("una lectura de OTRO contexto no se une: abre la suya y ve SU empresa (la unidad no mezcla empresas)", async () => {
    const contextoA = nuevoContexto(a);
    const contextoB = nuevoContexto(b);
    empezar();
    const vistas = await entorno.conLecturasCompartidas(contextoA, async () => {
      const deA = await leerEmpresa(contextoA);
      const deB = await leerEmpresa(contextoB);
      const otraVezA = await leerEmpresa(contextoA);
      return [deA, deB, otraVezA];
    });
    expect(vistas[0]).toBe(a.empresa);
    expect(vistas[1]).toBe(b.empresa);
    // Tras soltar la unidad para abrir la de B, la de A ya no comparte: cada una ve la empresa de SU contexto.
    expect(vistas[2]).toBe(a.empresa);
    expect((await conectados()).enTransaccion).toBe(0);
  });

  it("un contexto IGUAL pero otro objeto no se une (la identidad del contexto del pedido es lo que vale)", async () => {
    const contexto = nuevoContexto(a);
    const copia = { ...contexto };
    empezar();
    await entorno.conLecturasCompartidas(contexto, async () => {
      await leerEmpresa(contexto);
      await leerEmpresa(copia);
    });
    expect(cuantas(BEGIN)).toBe(2);
  });

  it("una escritura dentro del pedido abre su propia transacción serializable, se confirma y no queda dentro de la de lectura", async () => {
    const contexto = nuevoContexto(a);
    let nueva: EmpresaDePrueba | null = null;
    empezar();
    await entorno.conLecturasCompartidas(contexto, async () => {
      await leerEmpresa(contexto);
      nueva = await crearEmpresaActiva(entorno); // escribe con otro contexto y otro aislamiento
      await leerEmpresa(contexto);
    });
    // La empresa creada está confirmada y visible para otro cliente, sin esperar a que cierre el pedido.
    const { rows } = await dueno.query("select 1 from empresa where id = $1", [
      (nueva as EmpresaDePrueba | null)?.empresa,
    ]);
    expect(rows).toHaveLength(1);
    expect((await conectados()).enTransaccion).toBe(0);
  });

  it("una lectura que se hace con el aislamiento por defecto (serializable) tampoco se une", async () => {
    const contexto = nuevoContexto(a);
    empezar();
    await entorno.conLecturasCompartidas(contexto, async () => {
      await leerEmpresa(contexto);
      await entorno.ejecutar({ contexto, soloLectura: true }, () => Promise.resolve(ok(1)));
      await entorno.ejecutar({ contexto, aislamiento: "read committed" }, () =>
        Promise.resolve(ok(1)),
      );
    });
    expect(cuantas(BEGIN)).toBe(3);
  });

  it("una falla de la base en una lectura unida no arrastra a las siguientes: cada una abre la suya y andan", async () => {
    const contexto = nuevoContexto(a);
    const resultados = await entorno.conLecturasCompartidas(contexto, async () => {
      const rota = await entorno.ejecutar(
        { contexto, aislamiento: "read committed", soloLectura: true },
        async ({ db }) => {
          await sql`select columna_que_no_existe from empresa`.execute(db);
          return ok(1);
        },
      );
      const siguiente = await leerEmpresa(contexto);
      return { rota, siguiente };
    });
    expect(resultados.rota).toMatchObject({ ok: false, error: { tipo: "Inesperado" } });
    expect(resultados.siguiente).toBe(a.empresa);
    expect((await conectados()).enTransaccion).toBe(0);
  });

  it("una excepción que no viene de la base se vuelve a lanzar y la unidad no sigue compartiendo", async () => {
    const contexto = nuevoContexto(a);
    empezar();
    await entorno.conLecturasCompartidas(contexto, async () => {
      await expect(
        entorno.ejecutar(
          { contexto, aislamiento: "read committed", soloLectura: true },
          (): Promise<never> => Promise.reject(new RangeError("rol desconocido en la base")),
        ),
      ).rejects.toThrow("rol desconocido");
      await leerEmpresa(contexto);
    });
    expect(cuantas(BEGIN)).toBe(2);
    expect((await conectados()).enTransaccion).toBe(0);
  });

  it("varias lecturas a la vez dentro del pedido corren de a una por la misma conexión (nunca dos consultas superpuestas)", async () => {
    const contexto = nuevoContexto(a);
    const avisos: string[] = [];
    const alAvisar = (aviso: Error) => avisos.push(aviso.message);
    process.on("warning", alAvisar);
    const ventanas: Array<readonly [number, number]> = [];
    try {
      const vistas = await entorno.conLecturasCompartidas(contexto, () =>
        Promise.all(
          [1, 2, 3].map(() =>
            entorno.ejecutar(
              { contexto, aislamiento: "read committed", soloLectura: true },
              async ({ db }) => {
                const desde = performance.now();
                await sql`select pg_sleep(0.05)`.execute(db);
                ventanas.push([desde, performance.now()]);
                return ok(1);
              },
            ),
          ),
        ),
      );
      expect(vistas.every((v) => v.ok)).toBe(true);
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      process.off("warning", alAvisar);
    }
    const ordenadas = [...ventanas].sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < ordenadas.length; i++) {
      expect(ordenadas[i]?.[0] ?? 0).toBeGreaterThanOrEqual((ordenadas[i - 1]?.[1] ?? 0) - 1);
    }
    // Y el cliente de la base no se quejó de consultas superpuestas.
    expect(avisos.filter((m) => m.includes("already executing a query"))).toEqual([]);
  });

  it("una lectura que pide otra dentro de su propio trabajo no se traba esperándose a sí misma: la de adentro abre la suya", async () => {
    const contexto = nuevoContexto(a);
    empezar();
    const r = await entorno.conLecturasCompartidas(contexto, () =>
      entorno.ejecutar({ contexto, aislamiento: "read committed", soloLectura: true }, async () =>
        ok(await leerEmpresa(contexto)),
      ),
    );
    expect(r).toEqual({ ok: true, valor: a.empresa });
    expect(cuantas(BEGIN)).toBe(2);
    expect((await conectados()).enTransaccion).toBe(0);
  });

  it("40 pedidos simultáneos de dos empresas, sobre un pozo de 5 conexiones, no se cruzan y no se traban", async () => {
    empezar();
    const pedidos = Array.from({ length: 40 }, (_, i) => {
      const e = i % 2 === 0 ? a : b;
      const contexto = nuevoContexto(e);
      return entorno.conLecturasCompartidas(contexto, async () => {
        const vistas: string[] = [];
        for (let k = 0; k < 3; k++) vistas.push(await leerEmpresa(contexto));
        return { esperada: e.empresa, vistas };
      });
    });
    for (const r of await Promise.all(pedidos)) {
      expect(r.vistas).toEqual([r.esperada, r.esperada, r.esperada]);
    }
    expect(cuantas(BEGIN)).toBe(40);
    expect(cuantas(COMMIT)).toBe(40);
    expect((await conectados()).enTransaccion).toBe(0);
  });

  it("lo de un pedido no se ve desde otra cadena asíncrona: una lectura de afuera, con el mismo contexto, abre la suya", async () => {
    const contexto = nuevoContexto(a);
    let soltar: () => void = () => undefined;
    const espera = new Promise<void>((r) => {
      soltar = r;
    });
    let abierta: () => void = () => undefined;
    const yaAbrio = new Promise<void>((r) => {
      abierta = r;
    });
    const pedido = entorno.conLecturasCompartidas(contexto, async () => {
      await leerEmpresa(contexto);
      abierta();
      await espera;
      await leerEmpresa(contexto);
    });
    await yaAbrio;
    empezar();
    await leerEmpresa(contexto); // desde afuera del pedido, con el mismo objeto de contexto
    expect(cuantas(BEGIN)).toBe(1);
    expect(cuantas(COMMIT)).toBe(1);
    soltar();
    await pedido;
    expect((await conectados()).enTransaccion).toBe(0);
  });

  it("pasado el tope de vida de la unidad, las lecturas siguientes abren su propia transacción (con su propio contexto firmado)", async () => {
    const contexto = nuevoContexto(a);
    const real = Date.now();
    let reloj = real;
    const relojFalso = vi.spyOn(Date, "now").mockImplementation(() => reloj);
    try {
      empezar();
      await entorno.conLecturasCompartidas(contexto, async () => {
        await leerEmpresa(contexto);
        reloj = real + 61_000;
        await leerEmpresa(contexto);
        await leerEmpresa(contexto);
      });
      expect(cuantas(BEGIN)).toBe(3);
    } finally {
      relojFalso.mockRestore();
    }
  });

  describe("los permisos se leen una vez por pedido, nunca entre pedidos", () => {
    let persona: PersonaId;
    const membresias = () => cuantas(/from "membresia" as "m"/);
    beforeAll(async () => {
      const p = await crearPersonaDeBase(dueno);
      persona = personaId(p.id);
      await crearMembresiaDeBase(dueno, a.empresa, p.id, "GERENTE");
    });

    it("dentro del pedido, el rol, los módulos y el alcance se leen UNA vez aunque el guard y la pantalla los pidan varias", async () => {
      const contexto = nuevoContexto(a, persona);
      empezar();
      const datos = await entorno.conLecturasCompartidas(contexto, () =>
        entorno
          .ejecutar({ contexto, aislamiento: "read committed", soloLectura: true }, async (tx) => {
            const primero = await tx.autorizacion.delActor(contexto);
            const alcance = await tx.autorizacion.sucursalesDelActor(contexto, {
              incluirDesactivadas: true,
            });
            const otraVez = await tx.autorizacion.delActor(contexto);
            const abiertas = await tx.autorizacion.sucursalesDelActor(contexto);
            return ok({ primero, alcance, otraVez, abiertas });
          })
          .then((r) => {
            if (!r.ok) throw new Error("falló");
            return r.valor;
          }),
      );
      expect(datos.primero.rol).toBe("GERENTE");
      expect(datos.otraVez).toEqual(datos.primero);
      expect(datos.alcance).toBe("TODAS");
      expect(datos.abiertas).toBe("TODAS");
      expect(membresias()).toBe(1);
    });

    it("el pedido siguiente vuelve a leer: un permiso revocado se respeta en el pedido siguiente", async () => {
      const p = await crearPersonaDeBase(dueno);
      const operador = personaId(p.id);
      await crearMembresiaDeBase(dueno, a.empresa, p.id, "OPERADOR");
      const leerRol = async () => {
        const contexto = nuevoContexto(a, operador); // un pedido nuevo = un contexto nuevo
        return entorno.conLecturasCompartidas(contexto, async () => {
          const r = await entorno.ejecutar(
            { contexto, aislamiento: "read committed", soloLectura: true },
            async (tx) => ok(await tx.autorizacion.delActor(contexto)),
          );
          return r.ok ? r.valor.rol : "falló";
        });
      };
      expect(await leerRol()).toBe("OPERADOR");
      await dueno.query(
        "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
        [a.empresa, operador],
      );
      expect(await leerRol()).toBeNull();
      await dueno.query(
        "update membresia set activo = true where empresa_id = $1 and persona_id = $2",
        [a.empresa, operador],
      );
      expect(await leerRol()).toBe("OPERADOR");
    });

    it("en una transacción que ESCRIBE (serializable) no se memoriza: cada pregunta lee la base", async () => {
      const contexto = nuevoContexto(a, persona);
      empezar();
      const r = await entorno.ejecutar({ contexto }, async (tx) => {
        await tx.autorizacion.delActor(contexto);
        await tx.autorizacion.delActor(contexto);
        return ok(1);
      });
      expect(r.ok).toBe(true);
      expect(membresias()).toBe(2);
    });

    it("lo memorizado es de ESE contexto: con otro contexto, el mismo adaptador vuelve a leer", async () => {
      const uno = nuevoContexto(a, persona);
      const otro = nuevoContexto(a, persona);
      empezar();
      const r = await entorno.ejecutar(
        { contexto: uno, aislamiento: "read committed", soloLectura: true },
        async (tx) => {
          await tx.autorizacion.delActor(uno);
          await tx.autorizacion.delActor(otro);
          return ok(1);
        },
      );
      expect(r.ok).toBe(true);
      expect(membresias()).toBe(2);
    });

    it("el plan y los módulos del PEDIDO siguiente se leen de nuevo (nada queda guardado entre pedidos)", async () => {
      const pedido = () => {
        const contexto = nuevoContexto(a, persona);
        return entorno.conLecturasCompartidas(contexto, () =>
          entorno.ejecutar(
            { contexto, aislamiento: "read committed", soloLectura: true },
            async (tx) => ok(await tx.autorizacion.delActor(contexto)),
          ),
        );
      };
      empezar();
      await pedido();
      const primero = membresias();
      await pedido();
      expect(membresias()).toBe(primero * 2);
    });
  });

  it("el actor de plataforma (otro contexto) no usa la unidad de la empresa", async () => {
    const contexto = nuevoContexto(a);
    empezar();
    await entorno.conLecturasCompartidas(contexto, async () => {
      await leerEmpresa(contexto);
      const r = await entorno.ejecutar(
        { contexto: comoPlataforma(), aislamiento: "read committed", soloLectura: true },
        async ({ db }) => {
          const { rows } = await sql<{ rol: string }>`select current_user as rol`.execute(db);
          return ok(rows[0]?.rol);
        },
      );
      expect(r).toEqual({ ok: true, valor: "pedernal_plataforma" });
    });
    expect(cuantas(BEGIN)).toBe(2);
  });
});
