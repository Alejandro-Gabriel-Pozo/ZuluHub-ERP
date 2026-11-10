import type { RegistroDeAportes } from "../modulos/cierre/publico";
import { aporteDeVentas, type TxDeAporteDeVentas } from "../modulos/ventas/publico";
import type { TxDeAporteDeCaja } from "../modulos/caja/publico";
import { aporteDeCaja } from "./cierre-de-caja";

/**
 * Los aportes al cierre del día que registra la composición (E3b §3.4): caja (E3) y ventas (E4). Cada aporte pide a la transacción solo lo que
 * lee; el registro los junta con la intersección de lo que piden (la `Tx` compuesta lo contiene todo: `tipos-tx.test.ts`). `cierre` usa solo
 * los de los módulos activos de la empresa. Un aporte nuevo se suma acá.
 */
export const APORTES_AL_CIERRE: RegistroDeAportes<TxDeAporteDeCaja & TxDeAporteDeVentas> = [
  aporteDeCaja,
  aporteDeVentas,
];
