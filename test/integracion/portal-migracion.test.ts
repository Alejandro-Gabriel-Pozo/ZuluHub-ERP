import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { crearBaseAparte } from "./entorno";
import { valorDe } from "./catalogo-apoyo";
import { empresaConPortal, montarPortal, nuevoId } from "./portal-apoyo";
import type { BaseDePruebas } from "./global";
import {
  ERRORES_DE_PORTAL_POR_RESTRICCION,
  COLUMNAS_DE_PORTAL,
} from "../../src/modulos/portal/publico";
import { LARGO_MAXIMO_DEL_TELEFONO } from "../../src/primitivas/contacto/telefono";
import {
  LARGO_MAXIMO_DE_LA_LINEA_DEL_PORTAL,
  LARGO_MAXIMO_DEL_NOMBRE_DE_TARJETA,
  LARGO_MAXIMO_DEL_TITULO_DEL_PORTAL,
} from "../../src/primitivas/texto/datos-de-portal";

/**
 * Migraciones 0078 y 0083 contra una base real: forma y espejo con el código, privilegios, disparadores y la reversión (frena con datos; sin datos es repetible).
 * El escenario va con SQL del dueño de la base (que evade RLS).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const CARPETA = join(import.meta.dirname, "../../migraciones/reversiones");
const TABLAS = ["portal_de_empresa", "portal_tarjeta", "portal_zona"];

const conCliente = async <T>(url: string, trabajo: (c: pg.Client) => Promise<T>): Promise<T> => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await trabajo(c);
  } finally {
    await c.end();
  }
};
const correr = async (c: pg.Client, sql: string, confirmar = false) => {
  await c.query("begin");
  try {
    if (confirmar) await c.query("set local pedernal.confirmar_reversion = 'SI'");
    await c.query(sql);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
};

describe.skipIf(base === null)("migraciones 0078 y 0083: portal de la empresa", () => {
  it("forma y espejo: las columnas y restricciones de la base son las que declara el código, y los largos coinciden", async () => {
    const aparte = await crearBaseAparte(base as BaseDePruebas);
    try {
      await conCliente(aparte.base.dueno, async (c) => {
        for (const tabla of TABLAS) {
          const { rows } = await c.query<{ column_name: string }>(
            "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position",
            [tabla],
          );
          expect(rows.map((r) => r.column_name)).toEqual([
            ...COLUMNAS_DE_PORTAL[tabla as keyof typeof COLUMNAS_DE_PORTAL],
          ]);
        }
        const restricciones = await c.query<{ conname: string }>(
          "select conname from pg_constraint where conrelid = any($1::regclass[]) and contype in ('p','u','c','f') order by conname",
          [TABLAS],
        );
        const nombres = restricciones.rows.map((r) => r.conname);
        // Cada restricción de la base tiene su error declarado y cada error declarado de restricción (no de disparador) existe.
        expect(nombres.filter((n) => !Object.hasOwn(ERRORES_DE_PORTAL_POR_RESTRICCION, n))).toEqual(
          [],
        );
        const disparadores = [
          "portal_de_empresa_codigo_inmutable",
          "portal_de_empresa_identidad_inmutable",
          "portal_hijo_identidad_inmutable",
          "portal_tarjeta_sucursal_inmutable",
        ];
        expect(
          Object.keys(ERRORES_DE_PORTAL_POR_RESTRICCION).filter(
            (n) => !nombres.includes(n) && !disparadores.includes(n),
          ),
        ).toEqual([]);
        // Largos espejo: el CHECK de la base y la constante del código tienen el mismo borde.
        const defs = await c.query<{ conname: string; def: string }>(
          "select conname, pg_get_constraintdef(oid) as def from pg_constraint where conname in ('portal_de_empresa_linea_ck','portal_de_empresa_titulo_ck','portal_tarjeta_nombre_ck','portal_tarjeta_telefono_ck')",
        );
        const d = Object.fromEntries(defs.rows.map((r) => [r.conname, r.def]));
        expect(d["portal_de_empresa_linea_ck"]).toContain(
          `, ${LARGO_MAXIMO_DE_LA_LINEA_DEL_PORTAL})`,
        );
        expect(d["portal_de_empresa_titulo_ck"]).toContain(
          `, ${LARGO_MAXIMO_DEL_TITULO_DEL_PORTAL})`,
        );
        expect(d["portal_tarjeta_nombre_ck"]).toContain(`, ${LARGO_MAXIMO_DEL_NOMBRE_DE_TARJETA})`);
        expect(d["portal_tarjeta_telefono_ck"]).toContain(`<= ${LARGO_MAXIMO_DEL_TELEFONO})`);
      });
    } finally {
      await aparte.destruir();
    }
  });

  it("la reversión de 0083 no pierde datos y es repetible; la de 0078 FRENA con un portal cargado, con la confirmación lo borra y se puede repetir", async () => {
    const c = await montarPortal(base as BaseDePruebas);
    try {
      const r83 = await readFile(join(CARPETA, "0083_revertir_portal_por_plan.sql"), "utf8");
      const r78 = await readFile(join(CARPETA, "0078_revertir_portal_de_la_empresa.sql"), "utf8");
      const m = await empresaConPortal(c);
      valorDe(
        await c.casos.guardarPortalDeLaEmpresa(m.e.gerente, {
          id: nuevoId(),
          variante: "A",
          logoVisible: true,
        }),
      );
      const politicas = async () =>
        Number(
          (
            await c.dueno.query<{ n: string }>(
              "select count(*) as n from pg_policies where policyname like '%publico_de_portal'",
            )
          ).rows[0]?.n,
        );
      const antes = await politicas();
      expect(antes).toBeGreaterThan(0);
      await correr(c.dueno, r83);
      await correr(c.dueno, r83);
      expect(await politicas()).toBeLessThan(antes);
      expect(await c.contar("select count(*) as n from portal_de_empresa")).toBe(1);
      await expect(correr(c.dueno, r78)).rejects.toThrow(/hay 1 filas del portal/);
      expect(await c.contar("select count(*) as n from portal_de_empresa")).toBe(1);
      await correr(c.dueno, r78, true);
      expect(
        (
          await c.dueno.query<{ t: string | null }>(
            "select to_regclass('public.portal_de_empresa') as t",
          )
        ).rows[0]?.t,
      ).toBeNull();
      await correr(c.dueno, r78);
    } finally {
      await c.cerrar();
    }
  });
});
