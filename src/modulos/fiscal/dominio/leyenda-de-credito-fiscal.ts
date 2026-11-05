import type { LetraDeComprobante } from "./comprobante-emitido";
import type { CondicionIvaReceptor } from "./condicion-iva-receptor";

/**
 * Leyenda de la factura A (y de sus notas) emitida a un sujeto adherido al Monotributo (versión de representación 2 en adelante),
 * copiada de la norma sin parafrasear; si ARCA la cambia, es una versión nueva.
 * FUENTE (repositorio de docs, `12-referencias-externas/arca-normas-de-comprobantes/rg1415_dcp.html`): RG 1415 art. 15 a):
 * «Letra "A": […] Los comprobantes emitidos a sujetos monotributistas deberán contener la leyenda: "El crédito fiscal discriminado
 * en el presente comprobante, sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños
 * Contribuyentes de la Ley Nº 27.618"». Decisión del dueño: D-115 (a), 2026-11-05 (`11-especificaciones/facturador-contratos-de-pantalla.md`).
 * Previene que un comprobante A a monotributista salga sin el texto que la norma exige.
 */
export const LEYENDA_DE_CREDITO_FISCAL_A_MONOTRIBUTISTA =
  "El crédito fiscal discriminado en el presente comprobante, sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley Nº 27.618";

/**
 * La leyenda si la letra es A y el receptor es monotributista; `null` en cualquier otro caso. Las notas de crédito y de débito
 * llevan la letra de su asociado y el receptor del original, así que entran por la misma regla.
 * SUPUESTO: «monotributista» es solo la condición `MONOTRIBUTO`; el monotributo social y el trabajador independiente promovido
 * (también letra A) quedan fuera hasta que el dueño responda (D-115 d deja el promovido fuera de la primera versión).
 */
export function leyendaDeCreditoFiscal(
  letra: LetraDeComprobante,
  condicionIva: CondicionIvaReceptor,
): string | null {
  return letra === "A" && condicionIva === "MONOTRIBUTO"
    ? LEYENDA_DE_CREDITO_FISCAL_A_MONOTRIBUTISTA
    : null;
}
