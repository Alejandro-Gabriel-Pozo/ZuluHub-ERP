import { celdaPor } from "../../../primitivas/oraculo/celdas";
import {
  CELDAS_DE_COMPROBANTE,
  type CeldaDeComprobante,
  type IdDeCeldaDeComprobante,
} from "./oraculo-de-comprobante-datos";
import type { EstadoDeComprobanteArca } from "./estados-de-comprobante";

/**
 * El oráculo de factura y nota de crédito (fiscal): la lista esperada de lo que se puede y no se puede hacer con un comprobante emitido, con
 * sus derivaciones. Los DATOS están en `oraculo-de-comprobante-datos.ts`. Lo que depende del estado del comprobante se DERIVA de las tablas
 * del dominio (`TRANSICIONES_DE_COMPROBANTE` y `armarNotaAsociada`): el oráculo no las repite. Puro.
 */

export const ORACULO_DE_COMPROBANTE: readonly CeldaDeComprobante[] = CELDAS_DE_COMPROBANTE;

/** Una celda del oráculo de comprobante por su id (falla si el id no existe). */
export function celdaDeComprobante(id: IdDeCeldaDeComprobante): CeldaDeComprobante {
  return celdaPor(ORACULO_DE_COMPROBANTE, id);
}

/** Solo una factura AUTORIZADA se puede acreditar (C-03): el resto de los estados se rechaza con `ASOCIADO_NO_AUTORIZADO`. */
export function seAcreditaSegunElOraculo(estado: EstadoDeComprobanteArca): boolean {
  return estado === "AUTORIZADO";
}
