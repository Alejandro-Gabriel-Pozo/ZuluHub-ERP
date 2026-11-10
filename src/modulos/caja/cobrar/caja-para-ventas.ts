import { cobrosPorOrigen } from "./cobros-por-origen";
import type { CajaParaVentas } from "./contrato";
import { estadoDeCajasParaCobrar } from "./estado-de-cajas";
import { opcionesDeCobro } from "./opciones-de-cobro";
import { registrarCobroEnTx } from "./registrar-cobro";

/**
 * El puerto de caja que consume ventas (e3 §3.5). Es un objeto de funciones sin estado: cada una recibe la transacción del llamador. No pasa
 * por el guard de caja (autoriza ventas con `tickets.cobrar`) y no es una acción de servidor ni una ruta.
 */
export const cajaParaVentas: CajaParaVentas = {
  estadoDeCajasParaCobrar,
  opcionesDeCobro,
  registrarCobroEnTx,
  cobrosPorOrigen,
};
