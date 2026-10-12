import pg from "pg";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { TRANSICIONES_DE_TRABAJO, type EstadoDeTrabajo } from "../../src/puertos/cola-de-trabajos";
import { ok } from "../../src/primitivas/resultado/resultado";
import { comoTrabajos, crearBaseAparte, crearEntornoDePrueba } from "./entorno";

/**
 * 0003_trabajos: la máquina de estados de la cola vive en la base (un disparador), no solo en el
 * procesador. Un procesador con un defecto no puede reabrir un trabajo hecho, bajar los intentos para
 * burlar el tope ni guardar un error enorme.
 */

const base = inject("baseDePruebas");
const ESTADOS: readonly EstadoDeTrabajo[] = ["PENDIENTE", "EN_CURSO", "HECHO", "FALLIDO"];

describe.skipIf(base === null)("0003: la cola de trabajos en la base", () => {
  // Base propia: las filas de esta prueba no se mezclan con las de otros archivos.
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 3);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  let secuencia = 0;
  /** Inserta (como dueño) un trabajo de ámbito plataforma en el estado indicado. */
  const insertar = async (estado: EstadoDeTrabajo, intentos = 0): Promise<string> => {
    secuencia += 1;
    const { rows } = await dueno.query<{ id: string }>(
      `insert into trabajo (tipo, clave_idempotencia, estado, intentos)
       values ('demo', $1, $2, $3) returning id`,
      [`base-${secuencia}-${Date.now()}`, estado, intentos],
    );
    return rows[0]!.id;
  };

  it("la base permite exactamente las transiciones que el procesador conoce", async () => {
    await dueno.query("begin");
    try {
      for (const desde of ESTADOS) {
        for (const hacia of ESTADOS) {
          if (desde === hacia) continue;
          await dueno.query("savepoint s");
          const id = await insertar(desde);
          let permitida = true;
          try {
            await dueno.query("update trabajo set estado = $2 where id = $1", [id, hacia]);
          } catch (error) {
            expect(error).toMatchObject({
              code: "23514",
              constraint:
                desde === "HECHO" ? "trabajo_hecho_inmutable" : "trabajo_transicion_invalida",
            });
            permitida = false;
          }
          await dueno.query("rollback to savepoint s");
          expect(permitida, `${desde} → ${hacia}`).toBe(
            TRANSICIONES_DE_TRABAJO[desde].includes(hacia),
          );
        }
      }
    } finally {
      await dueno.query("rollback");
    }
  });

  it("quedarse en el mismo estado es válido salvo en HECHO (retomar un EN_CURSO con el plazo vencido)", async () => {
    await dueno.query("begin");
    try {
      for (const estado of ["PENDIENTE", "EN_CURSO", "FALLIDO"] as const) {
        const id = await insertar(estado);
        await dueno.query("update trabajo set ultimo_error = 'x', estado = $2 where id = $1", [
          id,
          estado,
        ]);
      }
    } finally {
      await dueno.query("rollback");
    }
  });

  it("un trabajo HECHO queda congelado: ni el error ni nada se modifica, ni siquiera por el dueño", async () => {
    await dueno.query("begin");
    try {
      const id = await insertar("HECHO", 1);
      await dueno.query("savepoint s");
      await expect(
        dueno.query("update trabajo set ultimo_error = 'tarde' where id = $1", [id]),
      ).rejects.toMatchObject({ code: "23514", constraint: "trabajo_hecho_inmutable" });
      await dueno.query("rollback to savepoint s");
      await expect(
        dueno.query("update trabajo set intentos = 5 where id = $1", [id]),
      ).rejects.toMatchObject({ code: "23514", constraint: "trabajo_hecho_inmutable" });
    } finally {
      await dueno.query("rollback");
    }
  });

  it("los intentos nunca bajan: bajarlos burlaría el tope de reintentos", async () => {
    const id = await insertar("EN_CURSO", 3);
    const bajar = (a: number) =>
      entorno.ejecutar(
        { contexto: comoTrabajos(), aislamiento: "read committed" },
        async ({ db }) => {
          await sql`update trabajo set intentos = ${a} where id = ${id}`.execute(db);
          return ok(null);
        },
      );
    expect(await bajar(2)).toEqual({
      ok: false,
      error: { tipo: "Check", restriccion: "trabajo_intentos_no_bajan" },
    });
    expect(await bajar(3)).toEqual({ ok: true, valor: null });
    expect(await bajar(4)).toEqual({ ok: true, valor: null });
  });

  it("el rol de trabajos no puede reabrir un HECHO ni saltearse la máquina de estados", async () => {
    const hecho = await insertar("HECHO", 1);
    const pendiente = await insertar("PENDIENTE");
    const cambiar = (id: string, estado: string) =>
      entorno.ejecutar(
        { contexto: comoTrabajos(), aislamiento: "read committed" },
        async ({ db }) => {
          await sql`update trabajo set estado = ${estado} where id = ${id}`.execute(db);
          return ok(null);
        },
      );
    expect(await cambiar(hecho, "PENDIENTE")).toEqual({
      ok: false,
      error: { tipo: "Check", restriccion: "trabajo_hecho_inmutable" },
    });
    expect(await cambiar(pendiente, "HECHO")).toEqual({
      ok: false,
      error: { tipo: "Check", restriccion: "trabajo_transicion_invalida" },
    });
    expect(await cambiar(pendiente, "EN_CURSO")).toEqual({ ok: true, valor: null });
  });

  it("el error guardado no pasa de 1000 caracteres", async () => {
    const id = await insertar("PENDIENTE");
    const guardar = (texto: string) =>
      entorno.ejecutar(
        { contexto: comoTrabajos(), aislamiento: "read committed" },
        async ({ db }) => {
          await sql`update trabajo set ultimo_error = ${texto} where id = ${id}`.execute(db);
          return ok(null);
        },
      );
    expect(await guardar("x".repeat(1000))).toEqual({ ok: true, valor: null });
    expect(await guardar("x".repeat(1001))).toEqual({
      ok: false,
      error: { tipo: "Check", restriccion: "trabajo_ultimo_error_ck" },
    });
  });

  it("la función del disparador fija su search_path y no es SECURITY DEFINER", async () => {
    const { rows } = await dueno.query<{ prosecdef: boolean; proconfig: string[] | null }>(
      "select prosecdef, proconfig from pg_proc where proname = 'trabajo_validar_cambio'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.prosecdef).toBe(false);
    expect(rows[0]!.proconfig).toEqual(["search_path=pg_catalog, public, pg_temp"]);
  });
});
