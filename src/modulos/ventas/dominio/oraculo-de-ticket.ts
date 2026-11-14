import {
  celdaPor,
  transicionesPermitidas,
  transicionesProhibidas,
} from "../../../primitivas/oraculo/celdas";
import { ESTADOS_DE_TICKET, type EstadoDeTicket } from "./estados";
import {
  CELDAS_DE_VENTAS_A,
  type CeldaDeVentas,
  type IdDeCeldaDeVentas,
} from "./oraculo-de-ticket-datos";
import { CELDAS_DE_VENTAS_B_Y_D } from "./oraculo-de-ticket-datos-facturar";

/**
 * El oráculo de ticket, cobranza y documento de ticket (ventas): la lista esperada de lo que el sistema puede y no puede hacer, con sus
 * derivaciones. Los DATOS están en `oraculo-de-ticket-datos.ts`; acá vive lo que se calcula de ellos. Las transiciones de estado se DERIVAN
 * de las celdas y se comparan con `TRANSICIONES_DE_TICKET` (y la base, en `ventas-migracion.test.ts`): una sola tabla de transiciones por
 * estado, no tres escritas aparte. Puro; sin reloj ni azar.
 */

export const ORACULO_DE_VENTAS: readonly CeldaDeVentas[] = [
  ...CELDAS_DE_VENTAS_A,
  ...CELDAS_DE_VENTAS_B_Y_D,
];

/** Una celda del oráculo de ventas por su id (falla si el id no existe). */
export function celdaDeVentas(id: IdDeCeldaDeVentas): CeldaDeVentas {
  return celdaPor(ORACULO_DE_VENTAS, id);
}

/** Las transiciones de ticket que el oráculo permite, en el formato de `TRANSICIONES_DE_TICKET`. */
export function transicionesDeTicketDelOraculo(): Readonly<
  Record<EstadoDeTicket, readonly EstadoDeTicket[]>
> {
  return transicionesPermitidas(ORACULO_DE_VENTAS, ESTADOS_DE_TICKET);
}

/** Las transiciones de ticket que alguna celda declara prohibidas, como pares `de>a`. */
export function transicionesDeTicketProhibidasPorElOraculo(): readonly string[] {
  return transicionesProhibidas(ORACULO_DE_VENTAS);
}
