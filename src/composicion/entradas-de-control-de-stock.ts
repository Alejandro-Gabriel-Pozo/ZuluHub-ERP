import { z } from "zod";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { identificador, leer } from "./entradas-de-facturacion";

/**
 * La entrada del tilde «Se controla el stock» de la ficha del producto: de lo que arma la página a lo que aceptan `controlarArticulo` y `dejarDeControlar`. Pura: sin base ni servidor.
 *
 * Lista de permitidos: del pedido solo se leen estas dos claves (`z.strictObject`: una de más lo rechaza entero; la empresa y la persona las pone el servidor). `controlado` es el ESTADO que
 * se quiere (no alterna): por eso repetir el pedido es seguro (los dos casos de uso responden «ya estaba» sin escribir). Previene: un pedido que alterna y el doble toque deshace lo hecho, o
 * uno que trae datos que decide el servidor. Chequeo: `entradas-de-control-de-stock.test.ts`.
 */

const FORMA_DEL_PEDIDO = z.strictObject({
  productoId: identificador,
  controlado: z.boolean(),
});

export type PedidoDeControlDeStock = z.output<typeof FORMA_DEL_PEDIDO>;

/** El pedido, o `"PEDIDO_INVALIDO"` si no tiene la forma pedida (sin decir cuál campo ni el valor recibido). */
export function leerElPedidoDeControlDeStock(
  crudo: unknown,
): Resultado<PedidoDeControlDeStock, "PEDIDO_INVALIDO"> {
  const forma = leer(FORMA_DEL_PEDIDO, crudo);
  return forma.ok ? forma : err("PEDIDO_INVALIDO");
}
