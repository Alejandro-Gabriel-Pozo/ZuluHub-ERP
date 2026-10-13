import { condicionAdmiteLetra, type CondicionIvaReceptor } from "./condicion-iva-receptor";
import type {
  ClaseDeComprobante,
  LetraDeComprobante,
  TipoDeComprobante,
} from "./comprobante-emitido";
import type { CondicionIva } from "./emisor";

/**
 * Letra de una factura (spec H7 facturación §B.3.1). La letra no se pregunta ni se elige: sale de
 * la condición del emisor y de la del receptor.
 *
 * - Responsable inscripto: A si el receptor admite la clase A (inscripto, monotributo, monotributo
 *   social o promovido: WSFE v4.8 l. 5718-5727); B para todos los demás.
 * - Monotributo: siempre C (la columna C del manual admite las once condiciones).
 * - Exento: siempre C. NO VERIFICADO: el manual no dice qué clase emite un emisor exento
 *   (pregunta C7 del contador).
 *
 * Una nota de crédito o de débito NO recalcula la letra: lleva la de su comprobante asociado.
 */
export function letraParaFactura(
  emisor: CondicionIva,
  receptor: CondicionIvaReceptor,
): LetraDeComprobante {
  if (emisor !== "RESPONSABLE_INSCRIPTO") return "C";
  return condicionAdmiteLetra(receptor, "A") ? "A" : "B";
}

/** El tipo de comprobante de una clase y una letra: `NOTA_CREDITO` + `B` = `NOTA_CREDITO_B`. */
export function tipoDeComprobante(
  clase: ClaseDeComprobante,
  letra: LetraDeComprobante,
): TipoDeComprobante {
  return `${clase}_${letra}`;
}
