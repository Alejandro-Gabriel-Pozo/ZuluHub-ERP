import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, inject, it } from "vitest";

/**
 * Los sellos de `migraciones/selladas.json` son EXACTAMENTE los checksums que el ejecutor registra en la tabla `migracion` al aplicar: si el
 * cálculo del ejecutor cambiara (otro fin de línea, otro algoritmo), los sellos dejarían de servir y esta prueba lo delata contra una base
 * real aplicada por el ejecutor. La comparación contra los archivos la hace `test/arquitectura/migraciones-selladas.test.ts`.
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)("sellos de migraciones contra el registro del ejecutor", () => {
  it("cada migración sellada tiene en la tabla `migracion` el mismo checksum que su sello", async () => {
    const sellos = JSON.parse(
      readFileSync(join(import.meta.dirname, "../../migraciones/selladas.json"), "utf8"),
    ) as Record<string, string>;
    const cliente = new pg.Client({ connectionString: (base as NonNullable<typeof base>).dueno });
    await cliente.connect();
    try {
      const filas = await cliente.query<{ nombre: string; checksum: string }>(
        "select nombre, checksum from migracion",
      );
      const registradas = new Map(filas.rows.map((f) => [f.nombre, f.checksum]));
      expect(Object.keys(sellos).length).toBeGreaterThan(70);
      for (const [nombre, sello] of Object.entries(sellos)) {
        expect([nombre, registradas.get(nombre)]).toEqual([nombre, sello]);
      }
    } finally {
      await cliente.end();
    }
  });
});
