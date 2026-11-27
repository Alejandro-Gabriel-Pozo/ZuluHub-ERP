import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { crearBaseAparte } from "./entorno";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";

/**
 * Migración 0115 (DM-3a): el cobrado de cada origen de la foto del cierre es la Σ de sus cobros menos lo devuelto. Cambia UNA función (`cierre_de_caja_verificar`) y no toca datos;
 * acá se prueba la migración como tal: la reversión restituye el cuerpo de 0027 (ni más ni menos), revertir dos veces no cambia nada y volver a aplicar deja el cuerpo de 0115. Que
 * el disparador acepte la cuenta neta y siga rechazando la que no cuadra lo prueban `caja-devolucion-cierre.test.ts` (el día se cierra con un ticket devuelto) y
 * `caja-cierre-migracion.test.ts` (la cuenta bruta sin devoluciones).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 90_000 });

const MIGRACION = "0115_cierre_de_caja_cobrado_neto_de_devoluciones.sql";
const REVERSION = "reversiones/0115_revertir_cierre_de_caja_cobrado_neto_de_devoluciones.sql";

describe.skipIf(base === null)("migración 0115: cobrado neto de devoluciones en el cierre", () => {
  const cuerpo = async (c: pg.Client): Promise<string> =>
    (
      await c.query<{ def: string }>(
        `select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'cierre_de_caja_verificar'`,
      )
    ).rows[0]?.def as string;

  it("la reversión restituye el cuerpo de 0027, repetirla no cambia nada y la migración se puede volver a aplicar con el mismo resultado", async () => {
    const aparte = await crearBaseAparte(base as NonNullable<typeof base>);
    const c = new pg.Client({ connectionString: aparte.base.dueno });
    await c.connect();
    try {
      const con = await cuerpo(c);
      expect(con).toContain("menos lo devuelto");
      expect(con).toContain("movimiento_de_dinero");
      const reversion = await readFile(join(CARPETA_DE_MIGRACIONES, REVERSION), "utf8");
      const migracion = await readFile(join(CARPETA_DE_MIGRACIONES, MIGRACION), "utf8");
      await c.query(reversion);
      const sin = await cuerpo(c);
      expect(sin).not.toBe(con);
      expect(sin).not.toContain("menos lo devuelto");
      expect(sin).not.toContain("movimiento_de_dinero");
      expect(
        (await c.query("select 1 from public.migracion where nombre = $1", [MIGRACION])).rowCount,
      ).toBe(0);
      await c.query(reversion);
      expect(await cuerpo(c)).toBe(sin);
      await c.query(migracion);
      expect(await cuerpo(c)).toBe(con);
    } finally {
      await c.end();
      await aparte.destruir();
    }
  });
});
