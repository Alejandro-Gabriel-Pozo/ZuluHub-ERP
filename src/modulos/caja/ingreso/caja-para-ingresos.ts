import type { CajaParaIngresos } from "./contrato";
import { anularIngresoEnTx, registrarIngresoEnTx } from "./ingreso-por-origen";

/**
 * El puerto de ingreso de caja que implementa la composición (LB-5): un objeto de funciones sin estado, cada una en la transacción de quien llama. No pasa por
 * el guard de caja (autoriza la acción que lo pide: gerente y administrador) y no es una acción de servidor ni una ruta.
 */
export const cajaParaIngresos: CajaParaIngresos = { registrarIngresoEnTx, anularIngresoEnTx };
