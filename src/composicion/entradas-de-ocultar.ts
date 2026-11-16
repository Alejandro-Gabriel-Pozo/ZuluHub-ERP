import { z } from "zod";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { identificador, leer } from "./entradas-de-facturacion";

/**
 * La entrada de «Ocultar» / «Volver a mostrar» (A15): de lo que arma la página a lo que acepta `ocultarProducto`. Pura: sin base ni servidor.
 *
 * Lista de permitidos: del pedido solo se leen estas claves (`z.strictObject`: una de más lo rechaza entero; la empresa y la persona las pone el servidor, y el local NO viaja en el
 * pedido: lo resuelve el servidor desde la sucursal elegida). `alcance` es un conjunto cerrado: `LOCAL` (el local con el que trabaja la persona) o `EMPRESA`. `oculto` es el ESTADO que se
 * quiere (no alterna): por eso repetir el pedido es seguro (regla `YA_ESTABA` del caso de uso). Previene: ocultar en un local que eligió el navegador y no la sesión, o un pedido que
 * alterna y el doble toque deshace lo hecho. Chequeo: `entradas-de-ocultar.test.ts`.
 */

const FORMA_DEL_PEDIDO = z.strictObject({
  productoId: identificador,
  alcance: z.enum(["LOCAL", "EMPRESA"]),
  oculto: z.boolean(),
});

export type PedidoDeOcultar = z.output<typeof FORMA_DEL_PEDIDO>;

/** El pedido, o `"PEDIDO_INVALIDO"` si no tiene la forma pedida (sin decir cuál campo ni el valor recibido). */
export function leerElPedidoDeOcultar(
  crudo: unknown,
): Resultado<PedidoDeOcultar, "PEDIDO_INVALIDO"> {
  const forma = leer(FORMA_DEL_PEDIDO, crudo);
  return forma.ok ? forma : err("PEDIDO_INVALIDO");
}
