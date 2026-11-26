import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import {
  esImporteEnCero,
  lineasDelPedido,
  type LineaDeLaVenta,
} from "../venta/modelo-de-la-cuenta";
import type { IdsDeLaVenta, VentaCobrada } from "./modelo-de-cobro";
import type { TextosDeVenderACuenta } from "./textos-de-vender-a-cuenta";

/**
 * Lo que la hoja «Vender a cuenta corriente» recibe del servidor (CC-5 B1b): la misma forma que entregan `listarLosClientesParaVender`, `verElClienteParaVender` y las dos acciones que cargan la venta. Los importes son
 * texto decimal con moneda (ADR-006); la pantalla no suma ni compara dinero con `number`: lo que pasaría con la venta lo calcula el servidor.
 */
export type ClienteParaElegirAlVender = Readonly<{
  parteId: string;
  nombre: string | null;
  cuit: string | null;
  plazoDias: number;
  estado: "HABILITADA" | "SUSPENDIDA";
}>;

type Importe = Readonly<{ moneda: string; monto: string }>;

export type ClienteElegidoAlVender = Readonly<{
  nombre: string | null;
  cuit: string | null;
  estado: "HABILITADA" | "SUSPENDIDA";
  saldo: Importe;
  disponible: Importe;
  excedido: boolean;
  puedeAprobarElExceso: boolean;
  saldoDespues: Importe | null;
  excedeEn: Importe | null;
}>;

export type VentaACuenta = Readonly<{
  ticketId: string;
  ejemplarId: string;
  numero: number;
  estado: string;
  fechaNegocio: string;
  total: Importe;
  yaExistia: boolean;
}>;

type AccionDeVenderACuenta<R> = (pedido: unknown) => Promise<Respuesta<R>>;

/** Lo que el cobro necesita para ofrecer la hoja: los clientes que se pueden elegir (ya cargados por la página) y las dos acciones de servidor. Sin él, el cobro no ofrece «Vender a cuenta corriente». */
export type VentaACuentaDelCobro = Readonly<{
  clientes: readonly ClienteParaElegirAlVender[];
  verCliente: AccionDeVenderACuenta<ClienteElegidoAlVender>;
  confirmar: AccionDeVenderACuenta<VentaACuenta>;
  textos: TextosDeVenderACuenta;
}>;

/** La venta cargada a cuenta con la forma del resultado del cobro: un ticket sin cobros (no entró plata a la caja). */
export const comoVentaCobrada = (venta: VentaACuenta): VentaCobrada => ({
  ticketId: venta.ticketId,
  ejemplarId: venta.ejemplarId,
  numero: venta.numero,
  estado: venta.estado,
  total: venta.total,
  cobros: [],
});

/** ¿La venta pasaría el límite? Lo dice el servidor (`excedeEn` mayor que cero); la pantalla solo lo lee. */
export const superaElLimite = (cliente: ClienteElegidoAlVender): boolean =>
  cliente.excedeEn !== null && !esImporteEnCero(cliente.excedeEn.monto);

/**
 * El pedido de «Confirmar venta a cuenta» (CC-5 B1b; la forma de `entradaDeVenderACuenta` y `entradaDeCerrarLaMesaACuenta`, que el servidor vuelve a leer con lista de permitidos): lo mismo que el de cobrar, sin caja ni
 * cobros, con el CLIENTE elegido. Los ids (cuenta, ejemplar, líneas) son los MISMOS del intento de cobro de la pantalla: repetir el envío devuelve el mismo ticket y no vuelve a cargar nada. Nunca lleva la aprobación de un exceso
 * (la primera etapa no la ofrece). `sinLineas`: la cuenta ya existe (la mesa). Devuelve `null` si hay líneas que no se pueden mandar: nunca un pedido a medias.
 */
export function pedidoDeVenderACuenta(
  entrada: Readonly<{
    ids: IdsDeLaVenta;
    clienteId: string;
    cuenta: readonly LineaDeLaVenta[];
    total: Readonly<{ moneda: string; monto: string }>;
    confirmaciones?: readonly string[] | undefined;
    sinLineas?: boolean | undefined;
  }>,
): Readonly<Record<string, unknown>> | null {
  const lineas =
    entrada.sinLineas === true ? [] : lineasDelPedido(entrada.ids.lineas, entrada.cuenta);
  if (lineas === null) return null;
  return {
    cuentaId: entrada.ids.cuentaId,
    ejemplarId: entrada.ids.ejemplarId,
    clienteId: entrada.clienteId,
    ...(entrada.sinLineas === true ? {} : { lineas }),
    totalEsperado: { moneda: entrada.total.moneda, monto: entrada.total.monto },
    ...(entrada.confirmaciones === undefined ? {} : { confirmaciones: entrada.confirmaciones }),
  };
}
