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

/** Cuántos productos se pueden volver a mostrar en un solo pedido (la lista de ocultos de una página; más se pide en otro pedido). */
export const MAXIMO_DE_PRODUCTOS_A_MOSTRAR = 50;

const FORMA_DEL_PEDIDO_DE_MOSTRAR = z.strictObject({
  productoIds: z.array(identificador).min(1).max(MAXIMO_DE_PRODUCTOS_A_MOSTRAR),
});

export type PedidoDeMostrar = z.output<typeof FORMA_DEL_PEDIDO_DE_MOSTRAR>;

/**
 * El pedido de «Volver a mostrar» uno o varios productos (C2): solo los ids (sin repetidos). Dónde están ocultos y en qué alcance NO viaja: lo lee el servidor. Una clave de más, una lista
 * vacía o de más de 50, o un id mal formado lo rechaza entero (sin decir cuál). Previene: mostrar en un alcance que eligió el navegador y un pedido sin tope.
 */
export function leerElPedidoDeMostrar(
  crudo: unknown,
): Resultado<PedidoDeMostrar, "PEDIDO_INVALIDO"> {
  const forma = leer(FORMA_DEL_PEDIDO_DE_MOSTRAR, crudo);
  return forma.ok
    ? { ok: true, valor: { productoIds: [...new Set(forma.valor.productoIds)] } }
    : err("PEDIDO_INVALIDO");
}
