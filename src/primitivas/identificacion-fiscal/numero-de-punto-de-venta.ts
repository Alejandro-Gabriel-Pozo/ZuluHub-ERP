/**
 * FICHA DEL DATO: NÚMERO DE PUNTO DE VENTA. Vive acá (una regla, un lugar): el dominio fiscal y la pantalla la importan; la base la repite con su CHECK.
 *
 * - Qué es: el número entero del punto de venta de un emisor. Único por emisor (dos CUIT pueden tener cada uno su punto de venta 1).
 * - Rango: de 1 a 99999. NO VERIFICADO contra ARCA (Pedernal-docs `11-especificaciones/h7-fiscal.md` §B.5, «Número entre 1 y 99999 … Rango NO
 *   VERIFICADO»); por eso es configurable (`RangoDeNumero`). Era un valor de `modulos/fiscal/dominio/punto-de-venta.ts`; se movió sin cambiar el valor.
 */
export type RangoDeNumero = Readonly<{ minimo: number; maximo: number }>;

export const RANGO_DE_NUMERO_DE_PUNTO_DE_VENTA: RangoDeNumero = { minimo: 1, maximo: 99999 };

/** ¿Es un entero dentro del rango (ambos extremos incluidos)? */
export function esNumeroDePuntoDeVentaEnRango(numero: number, rango: RangoDeNumero): boolean {
  return Number.isInteger(numero) && numero >= rango.minimo && numero <= rango.maximo;
}
