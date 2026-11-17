import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import type { BaseDePruebas } from "./global";
import { baseConMigraciones, CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";

/**
 * «Revertir y reaplicar» de las migraciones de compras (0063 en adelante): cada reversión borra DE VERDAD la fila de su migración del registro `migracion` (el nombre lleva el «.sql», como lo guarda el
 * ejecutor; con otro nombre no borra nada y la migración no se puede volver a aplicar), deja la base sin sus tablas y la migración se vuelve a aplicar completa. Previene: una reversión que no limpia el registro.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

const b = (): BaseDePruebas => {
  if (base === null) throw new Error("sin base de pruebas");
  return base;
};

const DESDE = "0063";

describe.skipIf(base === null)("compras: revertir y reaplicar", () => {
  let previa: Awaited<ReturnType<typeof baseConMigraciones>>;
  let cliente: pg.Client;
  beforeAll(async () => {
    const todas = (await readdir(CARPETA_DE_MIGRACIONES))
      .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n))
      .sort();
    previa = await baseConMigraciones(b(), todas);
    cliente = previa.cliente;
  });
  afterAll(async () => {
    if (base !== null) await previa.cerrar();
  });

  const archivos = async (carpeta: string): Promise<string[]> =>
    (await readdir(carpeta)).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort();

  it("cada reversión borra la fila de su migración del registro y la migración se puede volver a aplicar", async () => {
    const migraciones = (await archivos(CARPETA_DE_MIGRACIONES)).filter(
      (n) => n.slice(0, 4) >= DESDE,
    );
    const reversiones = await archivos(join(CARPETA_DE_MIGRACIONES, "reversiones"));
    expect(migraciones.length).toBeGreaterThanOrEqual(5);
    const registradas = async () =>
      (
        await cliente.query<{ nombre: string }>(
          "select nombre from migracion where nombre = any($1) order by nombre",
          [migraciones],
        )
      ).rows.map((r) => r.nombre);
    expect(await registradas()).toEqual(migraciones);
    // En orden inverso: cada reversión deja su fila afuera y nada más.
    for (const migracion of [...migraciones].reverse()) {
      const numero = migracion.slice(0, 4);
      const reversion = reversiones.find((r) => r.startsWith(`${numero}_revertir_`));
      expect(reversion, `falta la reversión de ${migracion}`).toBeDefined();
      const sql = await readFile(
        join(CARPETA_DE_MIGRACIONES, "reversiones", reversion as string),
        "utf8",
      );
      await cliente.query("begin");
      try {
        await cliente.query("set local pedernal.confirmar_reversion = 'SI'");
        await cliente.query(sql);
        await cliente.query("commit");
      } catch (error) {
        await cliente.query("rollback");
        throw error;
      }
      const quedan = await registradas();
      expect(quedan, `la reversión de ${migracion} no borró su fila`).not.toContain(migracion);
      expect(quedan.length).toBe(migraciones.indexOf(migracion));
    }
    expect(await registradas()).toEqual([]);
    await aplicarMigraciones(previa.aparte.base.dueno, CARPETA_DE_MIGRACIONES);
    expect(await registradas()).toEqual(migraciones);
  });
});
