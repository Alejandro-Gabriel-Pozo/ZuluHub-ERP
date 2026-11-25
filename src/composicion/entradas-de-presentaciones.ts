import { z } from "zod";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { decimal, entero, identificador, leer, texto } from "./entradas-de-facturacion";

/**
 * La entrada de la solapa «Cómo se compra» de un producto (T0): de lo que mandan los formularios a lo que aceptan `crearPresentacion` y `editarPresentacion`. Pura: sin base ni servidor.
 *
 * Lista de permitidos: de cada pedido solo se leen las claves que declara su esquema (`z.object` descarta el resto: no se puede mandar la empresa, la persona, la cantidad de una
 * presentación ya creada ni su estado por fuera de la acción), y la empresa y la persona las pone el servidor. Esta capa dice si el dato tiene la FORMA pedida; qué es un nombre o una
 * cantidad válidos lo decide el dominio dentro de la transacción (el largo y el conjunto permitido viven una vez, en su primitiva).
 * Chequeo: `entradas-de-presentaciones.test.ts`.
 */

const FORMA_DE_LAS_PRESENTACIONES = z.object({ productoId: identificador });
const FORMA_DE_CREAR = z.object({
  productoId: identificador,
  nombre: texto,
  cantidad: decimal,
  pesoVariable: z.boolean(),
});
const FORMA_DE_RENOMBRAR = z.object({
  productoId: identificador,
  presentacionId: identificador,
  versionEsperada: entero,
  nombre: texto,
});
const FORMA_DE_CAMBIAR_EL_ESTADO = z.object({
  productoId: identificador,
  presentacionId: identificador,
  versionEsperada: entero,
});

export type PedidoDeLasPresentaciones = z.output<typeof FORMA_DE_LAS_PRESENTACIONES>;
export type PedidoDeCrearPresentacion = z.output<typeof FORMA_DE_CREAR>;
export type PedidoDeRenombrarPresentacion = z.output<typeof FORMA_DE_RENOMBRAR>;
export type PedidoDeCambiarElEstado = z.output<typeof FORMA_DE_CAMBIAR_EL_ESTADO>;

type Pedido<T> = Resultado<T, "PEDIDO_INVALIDO">;

function leido<T>(esquema: z.ZodType<T>, crudo: unknown): Pedido<T> {
  const forma = leer(esquema, crudo);
  return forma.ok ? forma : err("PEDIDO_INVALIDO");
}

/** El pedido, o `"PEDIDO_INVALIDO"` si no tiene la forma pedida (sin decir cuál campo ni el valor recibido). */
export const leerElPedidoDeLasPresentaciones = (
  crudo: unknown,
): Pedido<PedidoDeLasPresentaciones> => leido(FORMA_DE_LAS_PRESENTACIONES, crudo);
export const leerElPedidoDeCrearPresentacion = (
  crudo: unknown,
): Pedido<PedidoDeCrearPresentacion> => leido(FORMA_DE_CREAR, crudo);
export const leerElPedidoDeRenombrarPresentacion = (
  crudo: unknown,
): Pedido<PedidoDeRenombrarPresentacion> => leido(FORMA_DE_RENOMBRAR, crudo);
export const leerElPedidoDeCambiarElEstado = (crudo: unknown): Pedido<PedidoDeCambiarElEstado> =>
  leido(FORMA_DE_CAMBIAR_EL_ESTADO, crudo);
