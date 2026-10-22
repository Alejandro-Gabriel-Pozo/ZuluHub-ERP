import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { personaId } from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import {
  comoEmpresa,
  crearBarrera,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  type EmpresaDePrueba,
} from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase } from "./fixtures-identidad";
import { asignarPlan, crearPlanPublicado } from "./marcas-apoyo";

/**
 * Q2: los módulos de la empresa se leen en UNA lectura consistente, aunque la plataforma los cambie a la
 * vez que otra operación los consulta (lectura pura: no escribe nada, no hay idempotencia que probar más
 * que «repetirla da lo mismo»). Cada cambio de la plataforma es ATÓMICO y mueve DOS cosas juntas (activar o
 * apagar el módulo y cambiar de plan), de modo que existen solo dos estados:
 *   S1 = módulo apagado, el plan lo incluye   -> activados [],            habilitados [facturacion]
 *   S2 = módulo activo, el plan NO lo incluye -> activados [facturacion], habilitados []
 * Una lectura que mezcla las mitades (activado según S2 y habilitado según S1) daría «activo y habilitado»,
 * un estado que NUNCA existió y que sí dejaría operar: eso es lo que nadie puede observar.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type Estado = Readonly<{ activados: readonly string[]; habilitados: readonly string[] }>;
const S1: Estado = { activados: [], habilitados: ["facturacion"] };
const S2: Estado = { activados: ["facturacion"], habilitados: [] };
const MEZCLA_PELIGROSA: Estado = { activados: ["facturacion"], habilitados: ["facturacion"] };

const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

describe.skipIf(base === null)("módulos de la empresa: lectura consistente y concurrente", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  let escritor: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 8);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    escritor = new pg.Client({ connectionString: propia.base.dueno });
    await escritor.connect();
  });
  afterAll(async () => {
    await escritor.end();
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  /** Una empresa en S1, con las dos versiones de plan listas para alternar. */
  const escenario = async () => {
    const e: EmpresaDePrueba = await crearEmpresaActiva(entorno);
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e.empresa, p.id, "GERENTE");
    const conModulo = (await crearPlanPublicado(dueno, { modulos: ["facturacion"] })).version;
    const sinModulo = (await crearPlanPublicado(dueno, { modulos: [] })).version;
    await dueno.query(
      "insert into modulo_de_empresa (empresa_id, modulo, activo) values ($1, 'facturacion', false)",
      [e.empresa],
    );
    await asignarPlan(dueno, e.tenant, conModulo);
    const ctx = (): ContextoOperativo => ({
      ...comoEmpresa(e.empresa, personaId(p.id)),
      ahora: new Date(),
    });
    /** Un cambio ATÓMICO de la plataforma: pasa a S2 (`true`) o vuelve a S1 (`false`). */
    const pasarA = async (activo: boolean, cliente: pg.Client = escritor) => {
      await cliente.query("begin");
      try {
        await cliente.query(
          "update modulo_de_empresa set activo = $2 where empresa_id = $1 and modulo = 'facturacion'",
          [e.empresa, activo],
        );
        await asignarPlan(cliente, e.tenant, activo ? sinModulo : conModulo);
        await cliente.query("commit");
      } catch (error) {
        await cliente.query("rollback");
        throw error;
      }
    };
    return { ...e, ctx, pasarA };
  };

  const leer = async (
    ctx: ContextoOperativo,
    aislamiento: "serializable" | "read committed",
    gapEnMs = 0,
  ): Promise<readonly Estado[]> => {
    const r = await entorno.ejecutar({ contexto: ctx, aislamiento }, async (tx) => {
      const lecturas: Estado[] = [];
      for (let i = 0; i < 2; i++) {
        if (i > 0 && gapEnMs > 0) await esperar(gapEnMs);
        const datos = await tx.autorizacion.delActor(ctx);
        lecturas.push({
          activados: datos.modulosActivados,
          habilitados: datos.modulosHabilitados,
        });
      }
      return ok(lecturas);
    });
    if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  it("cambios atómicos de la plataforma mientras se lee en serializable y en read committed: nunca se ve un estado a medias", async () => {
    const m = await escenario();
    const vueltas = 40;
    let terminado = false;
    const observados: Estado[] = [];

    const escribir = async () => {
      try {
        for (let i = 0; i < vueltas; i++) {
          await m.pasarA(i % 2 === 0);
          await esperar(2);
        }
      } finally {
        terminado = true;
      }
    };
    const lector = (aislamiento: "serializable" | "read committed") => async () => {
      while (!terminado) {
        const [primera, segunda] = await leer(m.ctx(), aislamiento, 3);
        if (primera === undefined || segunda === undefined) throw new Error("faltan lecturas");
        observados.push(primera, segunda);
        // En serializable las dos lecturas de una transacción son la MISMA foto.
        if (aislamiento === "serializable") expect(segunda).toEqual(primera);
      }
    };
    await Promise.all([
      escribir(),
      lector("serializable")(),
      lector("serializable")(),
      lector("read committed")(),
      lector("read committed")(),
    ]);

    expect(observados.length).toBeGreaterThan(0);
    for (const visto of observados) {
      expect(visto).not.toEqual(MEZCLA_PELIGROSA);
      expect([S1, S2]).toContainEqual(visto);
    }
  });

  it("dos operaciones simultáneas, con un cambio confirmado en el medio: cada transacción serializable sigue viendo su foto, y la siguiente el estado nuevo entero", async () => {
    const m = await escenario();
    const enElMedio = crearBarrera(3);
    let cambiado: () => void = () => undefined;
    const despuesDelCambio = new Promise<void>((resolver) => {
      cambiado = resolver;
    });

    const operacion = async () => {
      const ctx = m.ctx();
      const r = await entorno.ejecutar({ contexto: ctx }, async (tx) => {
        const antes = await tx.autorizacion.delActor(ctx);
        await enElMedio(); // las dos ya leyeron
        await despuesDelCambio; // la plataforma ya confirmó el cambio
        const despues = await tx.autorizacion.delActor(ctx);
        return ok({ antes, despues });
      });
      if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
      return r.valor;
    };
    const plataforma = async () => {
      await enElMedio();
      await m.pasarA(true);
      cambiado();
    };

    const [a, b] = await Promise.all([operacion(), operacion(), plataforma()]);
    for (const resultado of [a, b]) {
      expect(resultado?.antes).toEqual({ rol: "GERENTE", ...pares(S1) });
      expect(resultado?.despues).toEqual(resultado?.antes);
    }
    // Una operación que empieza después ve el estado nuevo, entero.
    expect(await leer(m.ctx(), "serializable")).toEqual([S2, S2]);
  });

  it("en read committed la lectura siguiente ve el estado nuevo ENTERO (no la mitad), y repetir la lectura da lo mismo", async () => {
    const m = await escenario();
    const ctx = m.ctx();
    const r = await entorno.ejecutar(
      { contexto: ctx, aislamiento: "read committed" },
      async (tx) => {
        const antes = await tx.autorizacion.delActor(ctx);
        await m.pasarA(true);
        const despues = await tx.autorizacion.delActor(ctx);
        const otraVez = await tx.autorizacion.delActor(ctx);
        return ok({ antes, despues, otraVez });
      },
    );
    expect(r).toEqual({
      ok: true,
      valor: {
        antes: { rol: "GERENTE", ...pares(S1) },
        despues: { rol: "GERENTE", ...pares(S2) },
        otraVez: { rol: "GERENTE", ...pares(S2) },
      },
    });
  });

  it("muchas lecturas simultáneas sin cambios dan todas lo mismo (la lectura es pura: no escribe ni toma bloqueos que frenen)", async () => {
    const m = await escenario();
    await m.pasarA(true);
    const resultados = await Promise.all(
      Array.from({ length: 24 }, () => leer(m.ctx(), "serializable")),
    );
    for (const lecturas of resultados) expect(lecturas).toEqual([S2, S2]);
  });
});

/** `modulosActivados` y `modulosHabilitados` de un estado, con los nombres del puerto. */
function pares(estado: Estado) {
  return { modulosActivados: estado.activados, modulosHabilitados: estado.habilitados };
}
