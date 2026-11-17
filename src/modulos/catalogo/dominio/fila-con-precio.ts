/**
 * ¿La fila de precio trae un precio? Una fila con precio nulo es «precio abierto» (sin sucursal) o «esta sucursal vuelve al precio de la empresa» (con sucursal): no es un
 * precio. Una sola definición: la usan la cotización de la caja y la carta pública, para que no puedan discrepar (carta real §4.4).
 */
export const filaConPrecio = <F extends Readonly<{ precio: string | null }>>(
  fila: F | null,
): fila is F & { precio: string } => fila !== null && fila.precio !== null;
