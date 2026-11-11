import type { Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";

export type OfertaDeProveedor = Readonly<{
  proveedorId: string;
  productoId: string;
  presentacionId: string | null;
  precioPorTipo: "PRESENTACION" | "UNIDAD";
  unidadDePrecioId: string | null;
  /** Texto decimal de 6 decimales. */
  ultimoPrecio: string;
  ultimoCostoPorUnidadDeStock: string;
  ultimaCompraId: string;
  ultimaCompraEn: Date;
}>;

/**
 * Lo que cada proveedor cobró por cada producto (E9 §3.2). No hay alta manual (S-6): la actualiza la propia compra (alta, y si ya había, un UPDATE con control de fecha) y conserva la compra MÁS NUEVA
 * (`ultima_compra_en`): dos compras que llegan invertidas dejan la más reciente, sin importar el orden en que se confirmen.
 */
export interface RepositorioDeOfertas {
  registrar(empresa: EmpresaId, oferta: OfertaDeProveedor): Promise<void>;
  delProducto(empresa: EmpresaId, productoId: string): Promise<readonly OfertaDeProveedor[]>;
  delProveedor(empresa: EmpresaId, proveedorId: string): Promise<readonly OfertaDeProveedor[]>;
}

const COLUMNAS = [
  "proveedor_id",
  "producto_id",
  "presentacion_id",
  "precio_por_tipo",
  "unidad_de_precio_id",
  "ultimo_precio",
  "ultimo_costo_por_unidad_de_stock",
  "ultima_compra_id",
  "ultima_compra_en",
] as const;

type Fila = {
  proveedor_id: string;
  producto_id: string;
  presentacion_id: string | null;
  precio_por_tipo: string;
  unidad_de_precio_id: string | null;
  ultimo_precio: string;
  ultimo_costo_por_unidad_de_stock: string;
  ultima_compra_id: string;
  ultima_compra_en: Date;
};

function aOferta(f: Fila): OfertaDeProveedor {
  if (f.precio_por_tipo !== "PRESENTACION" && f.precio_por_tipo !== "UNIDAD") {
    throw new RangeError(`precio por desconocido: ${f.precio_por_tipo}`);
  }
  return {
    proveedorId: f.proveedor_id,
    productoId: f.producto_id,
    presentacionId: f.presentacion_id,
    precioPorTipo: f.precio_por_tipo,
    unidadDePrecioId: f.unidad_de_precio_id,
    ultimoPrecio: f.ultimo_precio,
    ultimoCostoPorUnidadDeStock: f.ultimo_costo_por_unidad_de_stock,
    ultimaCompraId: f.ultima_compra_id,
    ultimaCompraEn: f.ultima_compra_en,
  };
}

export function crearRepositorioDeOfertas(db: Kysely<ComprasDb>): RepositorioDeOfertas {
  return {
    async registrar(empresa, oferta) {
      const nueva = await db
        .insertInto("oferta_de_proveedor")
        .values({
          empresa_id: empresa,
          proveedor_id: oferta.proveedorId,
          producto_id: oferta.productoId,
          presentacion_id: oferta.presentacionId,
          precio_por_tipo: oferta.precioPorTipo,
          unidad_de_precio_id: oferta.unidadDePrecioId,
          ultimo_precio: oferta.ultimoPrecio,
          ultimo_costo_por_unidad_de_stock: oferta.ultimoCostoPorUnidadDeStock,
          ultima_compra_id: oferta.ultimaCompraId,
          ultima_compra_en: oferta.ultimaCompraEn,
        })
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      if (nueva !== undefined) return;
      // Ya había una oferta: solo la pisa una compra igual de nueva o más nueva (el control de fecha va en el WHERE del UPDATE, no en un upsert).
      await db
        .updateTable("oferta_de_proveedor")
        .set({
          precio_por_tipo: oferta.precioPorTipo,
          unidad_de_precio_id: oferta.unidadDePrecioId,
          ultimo_precio: oferta.ultimoPrecio,
          ultimo_costo_por_unidad_de_stock: oferta.ultimoCostoPorUnidadDeStock,
          ultima_compra_id: oferta.ultimaCompraId,
          ultima_compra_en: oferta.ultimaCompraEn,
        })
        .where("empresa_id", "=", empresa)
        .where("proveedor_id", "=", oferta.proveedorId)
        .where("producto_id", "=", oferta.productoId)
        .where(
          "presentacion_id",
          oferta.presentacionId === null ? "is" : "=",
          oferta.presentacionId,
        )
        .where("ultima_compra_en", "<=", oferta.ultimaCompraEn)
        .execute();
    },
    async delProducto(empresa, productoId) {
      if (!esUuid(productoId)) return [];
      const filas = await db
        .selectFrom("oferta_de_proveedor")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", productoId)
        .orderBy("ultimo_costo_por_unidad_de_stock")
        .orderBy("proveedor_id")
        .execute();
      return filas.map(aOferta);
    },
    async delProveedor(empresa, proveedorId) {
      if (!esUuid(proveedorId)) return [];
      const filas = await db
        .selectFrom("oferta_de_proveedor")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("proveedor_id", "=", proveedorId)
        .orderBy("ultima_compra_en", "desc")
        .orderBy("producto_id")
        .execute();
      return filas.map(aOferta);
    },
  };
}
