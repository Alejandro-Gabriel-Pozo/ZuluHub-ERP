/**
 * EL ESTADO DE LA MESA SE DERIVA, NO SE GUARDA (E7 §3.6; maqueta 775). Es función pura de sus cuentas abiertas: así nunca queda desfasado de lo
 * que pasó de verdad (una mesa «ocupada» sin cuenta no puede existir). `LIBRE` = sin cuenta abierta; `EN_PEDIDO` = cuenta con algo sin enviar o en
 * espera, o todavía nada enviado; `OCUPADA` = al menos un envío y nada pendiente; `UNIDA` = la cuenta de reserva de una unión cuyo destino sigue
 * abierto. Una mesa dividida se muestra según sus cuentas hijas abiertas: la más atrasada manda (`EN_PEDIDO` atrasa más que `OCUPADA`).
 */
export type EstadoDeMesa = "LIBRE" | "EN_PEDIDO" | "OCUPADA" | "UNIDA";

export type CuentaParaElEstado = Readonly<{
  /** Líneas vigentes que todavía no se enviaron (`PARA_ENVIAR` y `ESPERA`). */
  pendientes: number;
  /** Envíos hechos de la cuenta. */
  envios: number;
}>;

export type EntradaDelEstado = Readonly<{
  /** Las cuentas ABIERTAS de la mesa (una, o las hijas de una división). */
  cuentas: readonly CuentaParaElEstado[];
  /** Si la mesa está unida a otra y su destino sigue abierto: el número de la mesa destino. */
  unidaAMesa: number | null;
}>;

const estaEnPedido = (cuenta: CuentaParaElEstado): boolean =>
  cuenta.pendientes > 0 || cuenta.envios === 0;

export function estadoDeMesa(entrada: EntradaDelEstado): EstadoDeMesa {
  if (entrada.unidaAMesa !== null) return "UNIDA";
  if (entrada.cuentas.length === 0) return "LIBRE";
  return entrada.cuentas.some(estaEnPedido) ? "EN_PEDIDO" : "OCUPADA";
}
