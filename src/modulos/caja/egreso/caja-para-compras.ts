import type { CajaParaCompras } from "./contrato";
import { anularEgresoEnTx, registrarEgresoEnTx } from "./egreso-por-origen";

/**
 * El puerto de caja que implementa la composición para compras (E9 T10b): un objeto de funciones sin estado, cada una en la transacción de quien llama.
 * No pasa por el guard de caja (autoriza compras con la acción que paga) y no es una acción de servidor ni una ruta.
 */
export const cajaParaCompras: CajaParaCompras = { registrarEgresoEnTx, anularEgresoEnTx };
