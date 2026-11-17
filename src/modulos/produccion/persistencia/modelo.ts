export type EstadoDeCosto = "SIN_COSTO" | "DEFINITIVO";

/** Una orden de producción tal como la guarda la base: decimales y fechas, como texto. */
export type OrdenGuardada = Readonly<{
  id: string;
  numero: number;
  estado: "ABIERTA" | "CERRADA" | "CANCELADA" | "ANULADA";
  productoId: string;
  articuloId: string;
  /** La versión de la receta SELLADA al abrir: no se relee. */
  composicionId: string;
  depositoId: string;
  depositoDestinoId: string;
  /** Texto decimal exacto, en la unidad de stock del artículo del producto. */
  cantidadEsperada: string;
  cantidadObtenida: string | null;
  loteId: string | null;
  /** `AAAA-MM-DD`. */
  vence: string | null;
  /** Costo congelado por unidad (6 decimales); `null` si `SIN_COSTO` o si la orden no se cerró. */
  costoUnitario: string | null;
  costoEstado: EstadoDeCosto | null;
  movimientoDeConsumoId: string | null;
  movimientoDeProductoId: string | null;
  anulacionDeConsumoId: string | null;
  anulacionDeProductoId: string | null;
  motivo: string | null;
  abiertaPor: string;
  abiertaEn: Date;
  cerradaPor: string | null;
  cerradaEn: Date | null;
  canceladaPor: string | null;
  canceladaEn: Date | null;
  anuladaPor: string | null;
  anuladaEn: Date | null;
  hechoEn: Date | null;
  fechaDeNegocio: string | null;
  version: number;
}>;

export type RenglonDeOrdenGuardado = Readonly<{
  numero: number;
  articuloId: string;
  composicionId: string | null;
  cantidadEsperada: string;
  cantidadReal: string | null;
}>;
