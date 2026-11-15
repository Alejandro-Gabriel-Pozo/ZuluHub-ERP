import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";

/**
 * Migración 0056 (la receta no lleva packaging ni limpieza, 14/11/2026) contra una base real: el disparador de alta rechaza un artículo de clase «insumo»
 * como componente, su reversión vuelve al cuerpo de 0032 y se puede repetir, y reaplicarla lo vuelve a rechazar. Que un componente con insumo sea rechazado
 * de verdad (la restricción `componente_articulo_es_insumo`) lo prueba `stock-migracion.test.ts`; que el caso de uso lo rechaza antes, `stock-composiciones.test.ts`.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const CARPETA = join(import.meta.dirname, "../../migraciones");
const MIGRACION = "0056_receta_sin_insumos.sql";
const REVERSION = join(CARPETA, "reversiones/0056_revertir_receta_sin_insumos.sql");

const conCliente = async <T>(url: string, trabajo: (c: pg.Client) => Promise<T>): Promise<T> => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await trabajo(c);
  } finally {
    await c.end();
  }
};
const funcion = async (c: pg.Client): Promise<string> =>
  (
    await c.query<{ d: string }>(
      "select pg_get_functiondef('componente_de_composicion_validar'::regproc) as d",
    )
  ).rows[0]?.d ?? "";

describe.skipIf(base === null)("migración 0056: la receta sin insumos", () => {
  it("rechaza el insumo; la reversión vuelve al cuerpo de 0032 y se repite; reaplicar lo vuelve a rechazar", async () => {
    const aparte = await crearBaseAparte(base as BaseDePruebas);
    try {
      await conCliente(aparte.base.dueno, async (c) => {
        expect(await funcion(c)).toContain("componente_articulo_es_insumo");
        const sql = await readFile(REVERSION, "utf8");
        for (let vez = 0; vez < 2; vez++) {
          await c.query("begin");
          await c.query(sql);
          await c.query("commit");
          const despues = await funcion(c);
          expect(despues).not.toContain("componente_articulo_es_insumo");
          // Sigue siendo el cuerpo de 0032: conserva las demás reglas del disparador.
          expect(despues).toContain("componente_articulo_inactivo");
          expect(despues).toContain("componente_compuesto_no_elaborado");
          expect(
            (await c.query("select 1 from migracion where nombre = $1", [MIGRACION])).rowCount,
          ).toBe(0);
        }
      });
      expect((await aplicarMigraciones(aparte.base.dueno, CARPETA)).aplicadas).toEqual([MIGRACION]);
      await conCliente(aparte.base.dueno, async (c) => {
        expect(await funcion(c)).toContain("componente_articulo_es_insumo");
      });
    } finally {
      await aparte.destruir();
    }
  });
});
