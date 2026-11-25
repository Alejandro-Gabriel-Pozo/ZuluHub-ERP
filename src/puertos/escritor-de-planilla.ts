import type { HojaDePlanilla } from "../primitivas/planilla/celda";

/**
 * Puerto del escritor de planillas (.xlsx): recibe hojas ya armadas y devuelve los bytes del archivo. Lo implementa `src/adaptadores/xlsx/` y es el ÚNICO lugar que conoce
 * la biblioteca de planillas. Contrato: el dinero sale como número SOLO si el texto decimal se lee idéntico como número (si no, como texto exacto); ninguna celda se interpreta como
 * fórmula; una celda vacía queda vacía (nunca cero). Es puro: sin reloj, sin red, sin disco.
 */
export interface EscritorDePlanilla {
  escribir(hojas: readonly HojaDePlanilla[]): Promise<Uint8Array>;
}
