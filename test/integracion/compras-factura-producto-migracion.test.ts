import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { claveDeCompra, huellaAlAzar, materiaPrima, proveedorDeBase } from "./compras-apoyo";
import { crearBaseAparte } from "./entorno";
import {
  acepta,
  conAppDe,
  crearMundo,
  denegado,
  intentoDelDueno,
  sinConfirmar,
  type Mundo,
} from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";

/**
 * Migración 0065 (compras N3): la línea de una factura puede decir de qué producto es. Prueba: la columna es nullable (las líneas de N1 y N2 no cambian), la clave foránea es
 * compuesta con la empresa (un producto de otra empresa no entra), la aplicación la escribe al alta y nunca la cambia, y la reversión frena con datos, es repetible y deja la tabla como antes.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const REVERSION = () =>
  readFile(
    join(
      CARPETA_DE_MIGRACIONES,
      "reversiones",
      "0065_revertir_producto_en_la_linea_de_la_factura.sql",
    ),
    "utf8",
  );

describe.skipIf(base === null)("0065: producto en la línea de la factura", () => {
  const b = () => base as BaseDePruebas;
  let aparte: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let m: Mundo;
  let otra: Mundo;

  beforeAll(async () => {
    aparte = await crearBaseAparte(b());
    dueno = new pg.Client({ connectionString: aparte.base.dueno });
    await dueno.connect();
    m = await crearMundo(dueno);
    otra = await crearMundo(dueno);
  });
  afterAll(async () => {
    await dueno.end();
    await aparte.destruir();
  });

  /** Un comprobante con una línea (con el producto o sin él) en UNA transacción: la línea solo entra con su cabecera. Devuelve el id o lanza lo que rechace la base. */
  const comprobanteConLinea = async (
    proveedor: string,
    producto: string | null,
    numero: number,
  ): Promise<string> => {
    const id = randomUUID();
    await dueno.query("begin");
    try {
      await dueno.query(
        `insert into comprobante_de_proveedor (id, empresa_id, proveedor_id, clase, tipo, punto_de_venta, numero, fecha_del_comprobante, neto_gravado, no_gravado, exento,
           iva, tributos_total, credito_fiscal_computable, total_calculado, total_segun_factura, proveedor_razon_social, nivel, clave_idempotencia, huella, registrado_por)
         values ($1, $2, $3, 'FACTURA', 'FACTURA_A', 1, $4, '2026-11-10', 1000, 0, 0, 210, 0, 210, 1210, 1210, 'Proveedor Sur', 'RECEPCION_SEPARADA', $5, $6, $7)`,
        [id, m.empresa, proveedor, numero, claveDeCompra(), huellaAlAzar(), m.persona],
      );
      await dueno.query(
        `insert into linea_de_comprobante (empresa_id, comprobante_id, numero, descripcion, unidad, cantidad_facturada, precio_neto, alicuota, neto_de_linea, iva_de_linea, producto_id)
         values ($1, $2, 1, 'Harina', 'GRAMO', 10, 100, '21', 1000, 210, $3)`,
        [m.empresa, id, producto],
      );
      await dueno.query("commit");
    } catch (error) {
      await dueno.query("rollback");
      throw error;
    }
    return id;
  };

  it("la línea puede traer el producto o no (las de N1 y N2 quedan en null); uno de otra empresa no entra", async () => {
    const proveedor = await proveedorDeBase(dueno, m);
    const propio = await materiaPrima(dueno, m.empresa);
    const ajeno = await materiaPrima(dueno, otra.empresa);
    const sin = await comprobanteConLinea(proveedor, null, 1);
    const con = await comprobanteConLinea(proveedor, propio, 2);
    await expect(comprobanteConLinea(proveedor, ajeno, 3)).rejects.toMatchObject({
      code: "23503",
      constraint: "linea_de_comprobante_producto_fkey",
    });
    const guardadas = await dueno.query<{ comprobante_id: string; producto_id: string | null }>(
      "select comprobante_id, producto_id from linea_de_comprobante where comprobante_id = any($1)",
      [[sin, con]],
    );
    const de = (id: string) => guardadas.rows.find((r) => r.comprobante_id === id)?.producto_id;
    expect(de(sin)).toBeNull();
    expect(de(con)).toBe(propio);
  });

  it("la aplicación no puede cambiar el producto de una línea (de solo inserción)", async () => {
    const proveedor = await proveedorDeBase(dueno, m);
    const producto = await materiaPrima(dueno, m.empresa);
    const comprobante = await comprobanteConLinea(proveedor, producto, 6);
    await conAppDe(b(), m, async (s) => {
      denegado(
        await s.intentar(
          "update linea_de_comprobante set producto_id = null where comprobante_id = $1",
          [comprobante],
        ),
      );
    });
  });

  it("la reversión frena si hay líneas con producto, con confirmación borra la columna y se puede repetir", async () => {
    const reversion = await REVERSION();
    const proveedor = await proveedorDeBase(dueno, m);
    const producto = await materiaPrima(dueno, m.empresa);
    await comprobanteConLinea(proveedor, producto, 7);
    await sinConfirmar(dueno, async () => {
      const frena = await intentoDelDueno(dueno, reversion);
      expect(frena.ok ? "" : frena.codigo).toBe("55000");
      await dueno.query("set local pedernal.confirmar_reversion = 'SI'");
      acepta(await intentoDelDueno(dueno, reversion));
      acepta(await intentoDelDueno(dueno, reversion));
      const columna = await dueno.query(
        "select 1 from information_schema.columns where table_name = 'linea_de_comprobante' and column_name = 'producto_id'",
      );
      expect(columna.rowCount).toBe(0);
    });
  });
});
