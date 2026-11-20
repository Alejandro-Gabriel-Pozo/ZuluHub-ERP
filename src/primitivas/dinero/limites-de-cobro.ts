/**
 * El tope de cobros de un ticket: UN solo lugar, porque lo usan el dominio de ventas (rechaza más de 50), el vuelto (la cuenta de la pantalla) y la hoja de
 * cobro (no ofrece «Agregar otro medio» pasado el tope). Previene: que la pantalla ofrezca un medio 51 que el servidor siempre rechaza, o que el tope de
 * uno cambie y el otro no. La base lo repite en `cobro_origen_orden_ck` (migración 0027: el orden del cobro va de 1 a 50).
 */
export const MAXIMO_DE_COBROS_POR_TICKET = 50;
