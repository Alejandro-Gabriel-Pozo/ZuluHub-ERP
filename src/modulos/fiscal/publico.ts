/** Entrada pública del módulo fiscal (ADR-001): los demás módulos solo importan de acá. */
export {
  CODIGOS_DE_ALICUOTA,
  esCodigoDeAlicuota,
  porcentajeDeAlicuota,
  type CodigoDeAlicuota,
} from "./dominio/alicuota";
export {
  calcularComprobante,
  desglosarAlicuota,
  type ComprobanteCalculado,
  type DesgloseDeAlicuota,
  type LineaDeComprobante,
} from "./dominio/comprobante";
