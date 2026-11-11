import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CODIGOS_DE_ERROR_DE_COMPRAS } from "../../src/modulos/compras/casos-de-uso/errores";
import { ERRORES_DE_COMPRAS_POR_RESTRICCION } from "../../src/modulos/compras/persistencia/errores-por-restriccion";
import {
  ALICUOTAS_DE_COMPRA,
  TIPOS_DE_COMPROBANTE_DE_PROVEEDOR,
  TIPOS_DE_TRIBUTO,
} from "../../src/modulos/compras/dominio/comprobante";
import {
  CLASES_DE_COMPROBANTE_DE_PROVEEDOR,
  NIVELES_DE_COMPRA,
} from "../../src/modulos/compras/dominio/niveles";
import type { BaseDePruebas } from "./global";

/**
 * El esquema de compras (0037) contra lo que el código dice de él: que TODA restricción de la base (y cada restricción que lanzan sus disparadores) tenga su
 * traducción a un error de negocio, que ninguna traducción apunte a algo que no existe, que toda única de una tabla de empresa incluya `empresa_id`, que
 * toda clave foránea entre tablas de empresa sea compuesta, y que las listas cerradas que el código repite (niveles, clases, tipos, alícuotas, tributos)
 * sean las de los CHECK de la base. Una regla, un lugar: si alguien cambia una sola punta, falla acá.
 */

const base = inject("baseDePruebas");
/** Los tres que el caso de uso devuelve con el id de la ganadora (objeto), no como código simple. */
const CON_ID = new Set([
  "REMITO_YA_REGISTRADO",
  "COMPROBANTE_YA_REGISTRADO",
  "COMPROBANTE_YA_PAGADO",
]);
const TABLAS = [
  "configuracion_de_compras",
  "ficha_de_compra_del_proveedor",
  "comprobante_de_la_ficha",
  "punto_de_venta_de_la_ficha",
  "pedido_de_ficha",
  "presentacion_de_producto",
  "oferta_de_proveedor",
  "recepcion",
  "linea_de_recepcion",
  "saldo_de_linea_de_recepcion",
  "comprobante_de_proveedor",
  "linea_de_comprobante",
  "importe_por_alicuota",
  "tributo_de_comprobante",
  "saldo_de_linea_de_comprobante",
  "conciliacion",
  "asignacion_de_conciliacion",
  "pago_de_comprobante",
  "correccion_de_compra",
];

describe.skipIf(base === null)("compras: la persistencia contra el esquema real", () => {
  let c: pg.Client;
  beforeAll(async () => {
    c = new pg.Client({ connectionString: (base as BaseDePruebas).dueno });
    await c.connect();
  });
  afterAll(async () => {
    await c.end();
  });

  it("cada restricción de la base y cada una que lanza un disparador tiene su traducción, y no sobra ninguna", async () => {
    const { rows } = await c.query<{ nombre: string }>(
      `select conname as nombre from pg_constraint
        where connamespace = 'public'::regnamespace and contype not in ('n', 't') and conrelid::regclass::text = any($1)
       union
       select indexname from pg_indexes where schemaname = 'public' and tablename = any($1) and indexdef like 'CREATE UNIQUE%'`,
      [TABLAS],
    );
    const migracion = await readFile(
      join(import.meta.dirname, "../../migraciones", "0037_compras.sql"),
      "utf8",
    );
    const fijas = [...migracion.matchAll(/CONSTRAINT = '(\w+)'/g)].map((m) => m[1] as string);
    // Las de nombre armado con el de la tabla (`TG_TABLE_NAME || '_inmutable'`): se expanden con las tablas que llevan ese disparador.
    const deLaTabla = (sufijo: string, tablas: readonly string[]) =>
      tablas.map((t) => `${t}_${sufijo}`);
    const armadas = [
      ...deLaTabla("inmutable", ["recepcion", "comprobante_de_proveedor", "pago_de_comprobante"]),
      ...deLaTabla("transicion_invalida", [
        "recepcion",
        "comprobante_de_proveedor",
        "pago_de_comprobante",
      ]),
      ...deLaTabla("cabecera_confirmada", [
        "linea_de_recepcion",
        "linea_de_comprobante",
        "importe_por_alicuota",
        "tributo_de_comprobante",
      ]),
      ...deLaTabla("solo_por_disparadores", [
        "saldo_de_linea_de_recepcion",
        "saldo_de_linea_de_comprobante",
      ]),
    ];
    expect(fijas.length).toBeGreaterThanOrEqual(3);
    expect(migracion).toContain("TG_TABLE_NAME || '_inmutable'");
    expect(migracion).toContain("TG_TABLE_NAME || '_transicion_invalida'");
    expect(migracion).toContain("TG_TABLE_NAME || '_cabecera_confirmada'");
    expect(migracion).toContain("TG_TABLE_NAME || '_solo_por_disparadores'");
    const existentes = new Set([...rows.map((r) => r.nombre), ...fijas, ...armadas]);
    const traducidas = new Set(Object.keys(ERRORES_DE_COMPRAS_POR_RESTRICCION));
    expect(
      [...existentes].filter((n) => !traducidas.has(n)).sort(),
      "restricciones sin traducción declarada",
    ).toEqual([]);
    expect(
      [...traducidas].filter((n) => !existentes.has(n)).sort(),
      "traducciones de restricciones que no existen",
    ).toEqual([]);
  });

  it("todo error de negocio al que traduce una restricción es un código declarado del módulo", () => {
    const declarados = new Set<string>(CODIGOS_DE_ERROR_DE_COMPRAS);
    const traducidos = new Set(
      Object.values(ERRORES_DE_COMPRAS_POR_RESTRICCION).filter((c) => c !== "NO_TRADUCIDA"),
    );
    expect(traducidos.size).toBeGreaterThan(5);
    expect([...traducidos].filter((c) => !declarados.has(c) && !CON_ID.has(c))).toEqual([]);
  });

  it("toda única de una tabla de empresa incluye `empresa_id` (salvo la clave primaria por `id`)", async () => {
    const { rows } = await c.query<{ indice: string; def: string }>(
      `select indexname as indice, indexdef as def from pg_indexes
        where schemaname = 'public' and tablename = any($1) and indexdef like 'CREATE UNIQUE%' and indexname not like '%_pkey'`,
      [TABLAS],
    );
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.filter((r) => !r.def.includes("empresa_id")).map((r) => r.indice)).toEqual([]);
  });

  it("toda clave foránea entre tablas de empresa es compuesta con `empresa_id`", async () => {
    const { rows } = await c.query<{ nombre: string; def: string }>(
      `select conname as nombre, pg_get_constraintdef(oid) as def from pg_constraint
        where connamespace = 'public'::regnamespace and contype = 'f' and conrelid::regclass::text = any($1)`,
      [TABLAS],
    );
    // Las que apuntan a `empresa`, a la persona o a la unidad de medida son a tablas globales; todas las demás (de empresa) llevan `empresa_id`.
    const aTablaDeEmpresa = rows.filter(
      (r) => !/REFERENCES (empresa|persona|unidad_de_medida)\(/.test(r.def),
    );
    expect(rows.length).toBeGreaterThan(30);
    expect(aTablaDeEmpresa.length).toBeGreaterThan(20);
    expect(
      aTablaDeEmpresa.filter((r) => !r.def.includes("empresa_id")).map((r) => r.nombre),
    ).toEqual([]);
  });

  it("toda tabla con el disparador de versión tiene `version` y `actualizado_en` (el disparador los pisa: sin ellos, el primer UPDATE falla)", async () => {
    const { rows } = await c.query<{ tabla: string; columnas: string[] }>(
      `select c.relname as tabla,
              array(select attname::text from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                      and attname in ('version', 'actualizado_en') order by attname) as columnas
         from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal and p.proname = 'fijar_version_y_fecha' and c.relname = any($1)`,
      [TABLAS],
    );
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(
      rows.filter((r) => r.columnas.join() !== "actualizado_en,version").map((r) => r.tabla),
    ).toEqual([]);
  });

  it("las listas cerradas del código son las de los CHECK de la base", async () => {
    const valores = async (tabla: string, nombre: string) => {
      const { rows } = await c.query<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1 and conrelid = $2::regclass",
        [nombre, tabla],
      );
      const def = rows[0]?.def ?? "";
      return [...def.matchAll(/'([A-Z_a-z0-9.]+)'::text/g)].map((m) => m[1] as string).sort();
    };
    expect(await valores("configuracion_de_compras", "configuracion_de_compras_nivel_ck")).toEqual(
      [...NIVELES_DE_COMPRA].sort(),
    );
    expect(await valores("recepcion", "recepcion_nivel_ck")).toEqual([...NIVELES_DE_COMPRA].sort());
    expect(await valores("comprobante_de_proveedor", "cp_nivel_ck")).toEqual(
      [...NIVELES_DE_COMPRA].sort(),
    );
    expect(await valores("conciliacion", "conciliacion_nivel_ck")).toEqual(
      [...NIVELES_DE_COMPRA].sort(),
    );
    expect(await valores("comprobante_de_proveedor", "cp_clase_ck")).toEqual(
      [...CLASES_DE_COMPROBANTE_DE_PROVEEDOR].sort(),
    );
    expect(await valores("comprobante_de_proveedor", "cp_tipo_ck")).toEqual(
      [...TIPOS_DE_COMPROBANTE_DE_PROVEEDOR].sort(),
    );
    expect(await valores("comprobante_de_la_ficha", "comprobante_de_la_ficha_tipo_ck")).toEqual(
      [...TIPOS_DE_COMPROBANTE_DE_PROVEEDOR].sort(),
    );
    expect(await valores("importe_por_alicuota", "importe_por_alicuota_alicuota_ck")).toEqual(
      [...ALICUOTAS_DE_COMPRA].sort(),
    );
    expect(await valores("linea_de_comprobante", "linea_de_comprobante_alicuota_ck")).toEqual(
      [...ALICUOTAS_DE_COMPRA].sort(),
    );
    expect(await valores("tributo_de_comprobante", "tributo_tipo_ck")).toEqual(
      [...TIPOS_DE_TRIBUTO].sort(),
    );
  });
});
