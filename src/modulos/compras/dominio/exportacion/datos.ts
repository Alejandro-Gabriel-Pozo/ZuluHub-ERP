import type { TipoDeComprobanteDeProveedor } from "../comprobante";

/**
 * Lo que la exportación lee de la base, ya armado y sin texto de pantalla: el caso de uso lo junta dentro de UNA transacción y `armar-hojas.ts` lo vuelve filas.
 * Los decimales viajan como TEXTO exacto (ADR-006), las fechas civiles como `AAAA-MM-DD` y los instantes como `Date`.
 */

export type PagoParaExportar = Readonly<{
  fechaDePago: string;
  medio: string;
  /** Texto decimal de 2 decimales: el total del comprobante al declarar el pago. */
  importe: string;
  estado: "VIGENTE" | "ANULADO";
}>;

export type ComprobanteParaExportar = Readonly<{
  id: string;
  tipo: TipoDeComprobanteDeProveedor | null;
  puntoDeVenta: number | null;
  numero: number | null;
  fechaDelComprobante: string | null;
  netoGravado: string;
  noGravado: string;
  exento: string;
  iva: string;
  tributosTotal: string;
  totalCalculado: string;
  totalSegunFactura: string;
  proveedorCuit: string | null;
  estado: "REGISTRADO" | "ANULADO";
  pagos: readonly PagoParaExportar[];
}>;

export type LineaParaExportar = Readonly<{
  numero: number;
  productoId: string;
  productoNombre: string;
  productoCodigo: string | null;
  clasificacion: string | null;
  presentacionNombre: string | null;
  /** La cantidad de la presentación en la unidad base (4 decimales); `null` si se compró por unidad. */
  presentacionCantidad: string | null;
  cantidadDeCompra: string;
  unidadDeCompraId: string;
  unidadDeCompraSimbolo: string;
  pesoReal: string | null;
  cantidadEnStock: string;
  unidadDeStockId: string;
  unidadDeStockSimbolo: string;
  /** El «precio por» vigente (el de la última corrección si la hubo); `null` si la línea está «Sin precio». */
  precio: string | null;
  precioPorTipo: "PRESENTACION" | "UNIDAD" | null;
  unidadDePrecioSimbolo: string | null;
  /** `null` = «Sin precio» (nunca cero). */
  importeVigente: string | null;
  /** El costo que guardó el alta; `null` si la línea no tiene precio o fue corregida (el costo de una corregida no se guarda). */
  costoPorUnidadDeStock: string | null;
  /** La parte del abonado de la factura que le toca (centavos exactos, mayor resto); `null` si no se puede repartir. Es DERIVADA. */
  importeAbonadoDerivado: string | null;
}>;

export type CompraParaExportar = Readonly<{
  recepcionId: string;
  numero: number;
  estado: "CONFIRMADA" | "ANULADA";
  fechaNegocio: string;
  sucursalId: string;
  sucursalNombre: string;
  proveedorNombre: string | null;
  registradoEn: Date;
  registradoPor: string;
  /** ¿Sale en la hoja Cabecera? (fecha del comprobante, o la de negocio si no tiene, dentro del período). */
  enCabecera: boolean;
  /** ¿Salen sus líneas en el Detalle y el Resumen? (fecha de negocio dentro del período). */
  enDetalle: boolean;
  comprobante: ComprobanteParaExportar | null;
  /** Todas las líneas de la compra, con sus importes vigentes. */
  lineas: readonly LineaParaExportar[];
}>;

/** Los rótulos de los valores que son texto de pantalla (los resuelve la capa de arriba desde el catálogo de textos aprobados; el dominio no escribe ninguno). */
export type RotulosDeExportacion = Readonly<{
  estadoDeLaCompra: (estado: "CONFIRMADA" | "ANULADA") => string;
  tipoDeComprobante: (clase: "FACTURA" | "NOTA_DE_DEBITO" | "NOTA_DE_CREDITO") => string;
  estadoDelPago: (estado: "PENDIENTE" | "PAGADO" | "ANULADO") => string;
  estadoDeLaFactura: (estado: "REGISTRADO" | "ANULADO") => string;
  medioDePago: (medio: string) => string;
  /** Los dos valores de «Precio por». */
  precioPor: (tipo: "PRESENTACION" | "UNIDAD") => string;
}>;
