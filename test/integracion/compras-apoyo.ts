import { randomUUID } from "node:crypto";
import type pg from "pg";
import { productoDeBase } from "./catalogo-apoyo";
import type { Mundo } from "./fiscal-apoyo";
import { numeroUnico } from "./unicos";

/** Armado de escenarios de compras con SQL del dueño (lo que se prueba pasa por el rol de la aplicación): un proveedor, un producto y datos de una compra. */

export const claveDeCompra = (): string => `clave-${randomUUID()}`;
export const huellaAlAzar = (): string => randomUUID().replaceAll("-", "").repeat(2);

export async function proveedorDeBase(
  c: pg.Client,
  m: Pick<Mundo, "empresa" | "persona">,
  nombre = "Proveedor Sur",
): Promise<string> {
  const id = randomUUID();
  await c.query(
    `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, creado_por) values ($1, $2, gen_random_uuid(), 'JURIDICA', $3, $4)`,
    [id, m.empresa, nombre, m.persona],
  );
  await c.query("insert into parte_rol (empresa_id, parte_id, rol) values ($1, $2, 'PROVEEDOR')", [
    m.empresa,
    id,
  ]);
  return id;
}

export const materiaPrima = (c: pg.Client, empresa: string): Promise<string> =>
  productoDeBase(c, empresa, { clase: "MATERIA_PRIMA" });

/** La recepción con una línea por SQL del dueño (dentro de una transacción propia). Devuelve ids. */
export async function recepcionDeBase(
  c: pg.Client,
  m: Pick<Mundo, "empresa" | "persona" | "sucursal">,
  proveedor: string,
  producto: string,
  extra: Readonly<{ remito?: readonly [number, number]; cantidad?: string; hechoEn?: string }> = {},
): Promise<string> {
  const id = randomUUID();
  await c.query("begin");
  try {
    await c.query(
      `insert into recepcion (id, empresa_id, sucursal_id, proveedor_id, nivel, remito_punto_de_venta, remito_numero, remito_fecha, hecho_en,
         clave_idempotencia, huella, registrado_por)
       values ($1, $2, $3, $4, 'COMPRA_SIMPLE', $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        m.empresa,
        m.sucursal,
        proveedor,
        extra.remito?.[0] ?? null,
        extra.remito?.[1] ?? null,
        extra.remito === undefined ? null : "2026-11-10",
        extra.hechoEn ?? "2026-11-10T15:00:00Z",
        claveDeCompra(),
        huellaAlAzar(),
        m.persona,
      ],
    );
    await c.query(
      `insert into linea_de_recepcion (empresa_id, recepcion_id, numero, producto_id, unidad_de_compra_id, cantidad_de_compra, cantidad_en_stock)
       values ($1, $2, 1, $3, 'UNIDAD', $4, $4)`,
      [m.empresa, id, producto, extra.cantidad ?? "10"],
    );
    await c.query("commit");
  } catch (error) {
    await c.query("rollback");
    throw error;
  }
  return id;
}

/** El comprobante (una factura A de una línea) con su línea, por SQL del dueño. */
export async function comprobanteDeBase(
  c: pg.Client,
  m: Pick<Mundo, "empresa" | "persona">,
  proveedor: string,
  extra: Readonly<{ numero?: number; puntoDeVenta?: number; tipo?: string }> = {},
): Promise<string> {
  const id = randomUUID();
  const tipo = extra.tipo ?? "FACTURA_A";
  await c.query("begin");
  try {
    await c.query(
      `insert into comprobante_de_proveedor (id, empresa_id, proveedor_id, clase, tipo, punto_de_venta, numero, fecha_del_comprobante, neto_gravado, no_gravado, exento,
         iva, tributos_total, credito_fiscal_computable, total_calculado, total_segun_factura, proveedor_razon_social, nivel, clave_idempotencia, huella, registrado_por)
       values ($1, $2, $3, $10, $4, $5, $6, '2026-11-10', 1000, 0, 0, 210, 0, 210, 1210, 1210, 'Proveedor Sur', 'CON_COMPROBANTE', $7, $8, $9)`,
      [
        id,
        m.empresa,
        proveedor,
        tipo,
        extra.puntoDeVenta ?? 1,
        extra.numero ?? numeroUnico(),
        claveDeCompra(),
        huellaAlAzar(),
        m.persona,
        tipo.startsWith("NOTA_CREDITO") ? "NOTA_DE_CREDITO" : "FACTURA",
      ],
    );
    await c.query(
      `insert into linea_de_comprobante (empresa_id, comprobante_id, numero, descripcion, unidad, cantidad_facturada, precio_neto, alicuota, neto_de_linea, iva_de_linea)
       values ($1, $2, 1, 'Harina', 'kg', 10, 100, '21', 1000, 210)`,
      [m.empresa, id],
    );
    await c.query("commit");
  } catch (error) {
    await c.query("rollback");
    throw error;
  }
  return id;
}
