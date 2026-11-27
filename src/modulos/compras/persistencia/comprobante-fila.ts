import { sql } from "kysely";
import { esTipoDeComprobanteDeProveedor } from "../dominio/comprobante";
import { esNivelDeCompra } from "../dominio/niveles";
import type { NivelDeCompra } from "../dominio/niveles";
import type { TipoDeComprobanteDeProveedor } from "../dominio/comprobante";

/** Las columnas de un comprobante, la fila que vuelve de la base y su paso al `ComprobanteGuardado` (separado del repositorio para no pasar del tope de líneas por archivo). */
export type EstadoDeComprobante = "REGISTRADO" | "ANULADO";

export type ComprobanteGuardado = Readonly<{
  id: string;
  proveedorId: string;
  clase: string;
  /** La factura que corrige (solo una nota de crédito). */
  comprobanteAsociadoId: string | null;
  /** La factura anulada que esta factura reemplaza (NOTAS-2); `null` en las demás. */
  reemplazaAId: string | null;
  tipo: TipoDeComprobanteDeProveedor | null;
  puntoDeVenta: number | null;
  numero: number | null;
  fechaDelComprobante: string | null;
  fechaDeVencimientoDePago: string | null;
  netoGravado: string;
  noGravado: string;
  exento: string;
  iva: string;
  tributosTotal: string;
  creditoFiscalComputable: string;
  totalCalculado: string;
  totalSegunFactura: string;
  proveedorCuit: string | null;
  proveedorRazonSocial: string;
  letraNoEsperada: boolean;
  nivel: NivelDeCompra;
  esAtajo: boolean;
  estado: EstadoDeComprobante;
  fechaNegocio: string;
  claveIdempotencia: string;
  huella: string;
  registradoPor: string;
  anuladoPor: string | null;
  anuladoEn: Date | null;
  motivoDeAnulacion: string | null;
  version: number;
}>;

export const COLUMNAS = [
  "id",
  "proveedor_id",
  "clase",
  "comprobante_asociado_id",
  "reemplaza_a_id",
  "tipo",
  "punto_de_venta",
  "numero",
  "neto_gravado",
  "no_gravado",
  "exento",
  "iva",
  "tributos_total",
  "credito_fiscal_computable",
  "total_calculado",
  "total_segun_factura",
  "proveedor_cuit",
  "proveedor_razon_social",
  "letra_no_esperada",
  "nivel",
  "es_atajo",
  "estado",
  "clave_idempotencia",
  "huella",
  "registrado_por",
  "anulado_por",
  "anulado_en",
  "motivo_de_anulacion",
  "version",
  sql<string | null>`fecha_del_comprobante::text`.as("fecha_del_comprobante"),
  sql<string | null>`fecha_de_vencimiento_de_pago::text`.as("fecha_de_vencimiento_de_pago"),
  sql<string>`fecha_negocio::text`.as("fecha_negocio"),
] as const;

export type Fila = {
  id: string;
  proveedor_id: string;
  clase: string;
  comprobante_asociado_id: string | null;
  reemplaza_a_id: string | null;
  tipo: string | null;
  punto_de_venta: number | null;
  numero: number | null;
  fecha_del_comprobante: string | null;
  fecha_de_vencimiento_de_pago: string | null;
  neto_gravado: string;
  no_gravado: string;
  exento: string;
  iva: string;
  tributos_total: string;
  credito_fiscal_computable: string;
  total_calculado: string;
  total_segun_factura: string;
  proveedor_cuit: string | null;
  proveedor_razon_social: string;
  letra_no_esperada: boolean;
  nivel: string;
  es_atajo: boolean;
  estado: string;
  fecha_negocio: string;
  clave_idempotencia: string;
  huella: string;
  registrado_por: string;
  anulado_por: string | null;
  anulado_en: Date | null;
  motivo_de_anulacion: string | null;
  version: number;
};

export function aComprobante(f: Fila): ComprobanteGuardado {
  if (!esNivelDeCompra(f.nivel)) throw new RangeError(`nivel de compra desconocido: ${f.nivel}`);
  if (f.estado !== "REGISTRADO" && f.estado !== "ANULADO") {
    throw new RangeError(`estado de comprobante desconocido: ${f.estado}`);
  }
  if (f.tipo !== null && !esTipoDeComprobanteDeProveedor(f.tipo)) {
    throw new RangeError(`tipo de comprobante desconocido: ${f.tipo}`);
  }
  return {
    id: f.id,
    proveedorId: f.proveedor_id,
    clase: f.clase,
    comprobanteAsociadoId: f.comprobante_asociado_id,
    reemplazaAId: f.reemplaza_a_id,
    tipo: f.tipo,
    puntoDeVenta: f.punto_de_venta,
    numero: f.numero,
    fechaDelComprobante: f.fecha_del_comprobante,
    fechaDeVencimientoDePago: f.fecha_de_vencimiento_de_pago,
    netoGravado: f.neto_gravado,
    noGravado: f.no_gravado,
    exento: f.exento,
    iva: f.iva,
    tributosTotal: f.tributos_total,
    creditoFiscalComputable: f.credito_fiscal_computable,
    totalCalculado: f.total_calculado,
    totalSegunFactura: f.total_segun_factura,
    proveedorCuit: f.proveedor_cuit,
    proveedorRazonSocial: f.proveedor_razon_social,
    letraNoEsperada: f.letra_no_esperada,
    nivel: f.nivel,
    esAtajo: f.es_atajo,
    estado: f.estado,
    fechaNegocio: f.fecha_negocio,
    claveIdempotencia: f.clave_idempotencia,
    huella: f.huella,
    registradoPor: f.registrado_por,
    anuladoPor: f.anulado_por,
    anuladoEn: f.anulado_en,
    motivoDeAnulacion: f.motivo_de_anulacion,
    version: f.version,
  };
}
