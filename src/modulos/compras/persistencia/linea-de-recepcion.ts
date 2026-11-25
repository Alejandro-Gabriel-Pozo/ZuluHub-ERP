/**
 * La línea de una recepción (`linea_de_recepcion`) tal como la lee compras: el tipo, las columnas que se piden y la fila como línea. Vive aparte de `repositorio-de-recepciones.ts` para que ese archivo
 * no pase del tope de tamaño; el repositorio re-exporta el tipo y todo el módulo sigue importándolo de ahí.
 */

export type LineaDeRecepcion = Readonly<{
  numero: number;
  productoId: string;
  presentacionId: string | null;
  unidadDeCompraId: string;
  cantidadDeCompra: string;
  dePesoVariable: boolean;
  pesoReal: string | null;
  /** Lo que entra al stock, en la unidad base del producto (texto decimal de 4 decimales). */
  cantidadEnStock: string;
  precioPorTipo: "PRESENTACION" | "UNIDAD" | null;
  unidadDePrecioId: string | null;
  precio: string | null;
  importe: string | null;
  costoPorUnidadDeStock: string | null;
  depositoId: string | null;
  movimientoId: string | null;
}>;

export const COLUMNAS_DE_LINEA = [
  "numero",
  "producto_id",
  "presentacion_id",
  "unidad_de_compra_id",
  "cantidad_de_compra",
  "de_peso_variable",
  "peso_real",
  "cantidad_en_stock",
  "precio_por_tipo",
  "unidad_de_precio_id",
  "precio",
  "importe",
  "costo_por_unidad_de_stock",
  "deposito_id",
  "movimiento_id",
] as const;

/** La fila de `linea_de_recepcion` (las columnas de `COLUMNAS_DE_LINEA`) como línea del dominio: la usan `lineasDe` y `lineasDeVarias`. */
export const aLinea = (f: {
  numero: number;
  producto_id: string;
  presentacion_id: string | null;
  unidad_de_compra_id: string;
  cantidad_de_compra: string;
  de_peso_variable: boolean;
  peso_real: string | null;
  cantidad_en_stock: string;
  precio_por_tipo: string | null;
  unidad_de_precio_id: string | null;
  precio: string | null;
  importe: string | null;
  costo_por_unidad_de_stock: string | null;
  deposito_id: string | null;
  movimiento_id: string | null;
}): LineaDeRecepcion => ({
  numero: f.numero,
  productoId: f.producto_id,
  presentacionId: f.presentacion_id,
  unidadDeCompraId: f.unidad_de_compra_id,
  cantidadDeCompra: f.cantidad_de_compra,
  dePesoVariable: f.de_peso_variable,
  pesoReal: f.peso_real,
  cantidadEnStock: f.cantidad_en_stock,
  precioPorTipo:
    f.precio_por_tipo === "PRESENTACION" || f.precio_por_tipo === "UNIDAD"
      ? f.precio_por_tipo
      : null,
  unidadDePrecioId: f.unidad_de_precio_id,
  precio: f.precio,
  importe: f.importe,
  costoPorUnidadDeStock: f.costo_por_unidad_de_stock,
  depositoId: f.deposito_id,
  movimientoId: f.movimiento_id,
});
