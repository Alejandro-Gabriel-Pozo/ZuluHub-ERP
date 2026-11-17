/**
 * El cuerpo transaccional de la numeración (spec H7 facturación §B.2.3, punto 1), SIN guard. Lo
 * llaman los casos de uso de T6 (`reservarNumeroDeComprobante`, `cerrarReservaDeNumero`), que exigen
 * el permiso de la persona antes, y el trabajo de validación del facturador, que corre sin persona
 * (ADR-007) dentro de su propia transacción. Previene: dos copias de la lógica de reserva que se
 * desvíen (un número duplicado o con hueco).
 *
 * Reglas de quien llama: ya abrió la transacción (SERIALIZABLE) y ya autorizó la acción. Estas
 * funciones NO se exportan por `publico.ts`: exponerlas sería exponer la numeración sin guard.
 *
 * Esta es la única puerta: el cuerpo vive repartido por responsabilidad en `numeracion-reservar-en-tx.ts`,
 * `numeracion-cerrar-en-tx.ts` (cierre normal y fuera de secuencia, que comparten qué se audita) y
 * `numeracion-resincronizar-en-tx.ts`. Quien llama importa siempre de acá.
 */
export { reservarEnTx } from "./numeracion-reservar-en-tx";
export type {
  EntradaDeReservarNumero,
  ErrorPropioAlReservar,
  PasoDeReserva,
  SalidaDeReservarNumero,
} from "./numeracion-reservar-en-tx";
export { cerrarEnTx, cerrarFueraDeSecuenciaEnTx } from "./numeracion-cerrar-en-tx";
export type {
  EntradaDeCerrarFueraDeSecuencia,
  EntradaDeCerrarReserva,
  ErrorPropioAlCerrar,
  SalidaDeCerrarFueraDeSecuencia,
  SalidaDeCerrarReserva,
} from "./numeracion-cerrar-en-tx";
export { resincronizarEnTx } from "./numeracion-resincronizar-en-tx";
export type {
  EntradaDeResincronizarSerie,
  ErrorPropioAlResincronizar,
  SalidaDeResincronizarSerie,
} from "./numeracion-resincronizar-en-tx";
