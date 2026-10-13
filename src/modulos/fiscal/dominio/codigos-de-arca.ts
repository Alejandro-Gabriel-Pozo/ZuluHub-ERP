import type { Moneda } from "../../../primitivas/dinero/moneda";
import type { TipoDeComprobante } from "./comprobante-emitido";
import type { DocumentoDelReceptor } from "./receptor";

/**
 * Los códigos numéricos que ARCA espera (y que lleva el QR). Una sola tabla por concepto, cada una
 * con su fuente; el resto de los códigos (condición del receptor, alícuotas, concepto) vive en el
 * adaptador porque el manual no los confirma todos (spec H7 facturación §B.3.2 y §B.3.4).
 */

/** Tipos de comprobante: WSFE v4.8, error 10007 (l. 962): 1, 2, 3 = A; 6, 7, 8 = B; 11, 12, 13 = C. */
export const CODIGO_DE_TIPO_DE_COMPROBANTE: Readonly<Record<TipoDeComprobante, number>> = {
  FACTURA_A: 1,
  NOTA_DEBITO_A: 2,
  NOTA_CREDITO_A: 3,
  FACTURA_B: 6,
  NOTA_DEBITO_B: 7,
  NOTA_CREDITO_B: 8,
  FACTURA_C: 11,
  NOTA_DEBITO_C: 12,
  NOTA_CREDITO_C: 13,
};

/**
 * Tipos de documento. CONFIRMADOS por WSFE v4.8: 80 (CUIT, error 10013) y 99 (sin identificar, error
 * 10015); el manual nombra 86 y 87 junto al 80 como documentos verificables en el padrón (CUIL y
 * CDI). NO VERIFICADOS hasta `FEParamGetTiposDoc` en el espía: 96 (DNI) y 94 (pasaporte).
 */
export const CODIGO_DE_TIPO_DE_DOCUMENTO: Readonly<Record<DocumentoDelReceptor["tipo"], number>> = {
  CUIT: 80,
  CUIL: 86,
  CDI: 87,
  DNI: 96,
  PASAPORTE: 94,
  SIN_IDENTIFICAR: 99,
};

/** Código de moneda (`MonId`, WSFE v4.8): `PES` son los pesos argentinos y su cotización es 1. */
export const CODIGO_DE_MONEDA: Readonly<Record<Moneda, string>> = { ARS: "PES" };
