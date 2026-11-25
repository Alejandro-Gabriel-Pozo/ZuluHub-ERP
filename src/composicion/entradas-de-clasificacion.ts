import { z } from "zod";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { entero, identificador, leer, texto } from "./entradas-de-facturacion";

/**
 * Las entradas de la clasificación comercial (A14; maqueta aprobada `clasificacion.html`): de lo que manda la pantalla a lo que aceptan los casos de uso del árbol y `clasificarProducto`.
 * Puras: sin base ni servidor.
 *
 * Lista de permitidos: de cada pedido solo se leen las claves que declara su esquema (`z.object` descarta el resto: no se puede mandar la empresa, la persona ni la fecha desde la que rige
 * un cambio, que decide el servidor). Esta capa dice si el dato tiene la FORMA pedida; qué es un nombre válido, un destino posible o un nodo activo lo deciden la primitiva y el caso de uso
 * dentro de la transacción. Las claves de idempotencia (`id` del nodo nuevo y del vínculo) las fija la pantalla al abrir la hoja: el doble toque y el reintento mandan la misma.
 * Chequeo: `entradas-de-clasificacion.test.ts`.
 */

const FORMAS = {
  crear: z.object({ id: identificador, padreId: identificador.nullable(), nombre: texto }),
  renombrar: z.object({ nodoId: identificador, versionEsperada: entero, nombre: texto }),
  mover: z.object({
    nodoId: identificador,
    versionEsperada: entero,
    nuevoPadreId: identificador,
  }),
  cambiarActivo: z.object({ nodoId: identificador }),
  clasificar: z.object({
    id: identificador,
    productoId: identificador,
    nodoId: identificador.nullable(),
  }),
};

export type PedidoDeCrearNodo = z.output<typeof FORMAS.crear>;
export type PedidoDeRenombrarNodo = z.output<typeof FORMAS.renombrar>;
export type PedidoDeMoverNodo = z.output<typeof FORMAS.mover>;
export type PedidoDeCambiarActivoDeNodo = z.output<typeof FORMAS.cambiarActivo>;
export type PedidoDeClasificarProducto = z.output<typeof FORMAS.clasificar>;

function leerElPedido<S extends z.ZodType>(
  forma: S,
  crudo: unknown,
): Resultado<z.output<S>, "PEDIDO_INVALIDO"> {
  const leido = leer(forma, crudo);
  return leido.ok ? leido : err("PEDIDO_INVALIDO");
}

/** Cada lector devuelve el pedido, o `"PEDIDO_INVALIDO"` si no tiene la forma pedida (sin decir cuál campo ni el valor recibido). */
export const leerElPedidoDeCrearNodo = (crudo: unknown) => leerElPedido(FORMAS.crear, crudo);
export const leerElPedidoDeRenombrarNodo = (crudo: unknown) =>
  leerElPedido(FORMAS.renombrar, crudo);
export const leerElPedidoDeMoverNodo = (crudo: unknown) => leerElPedido(FORMAS.mover, crudo);
export const leerElPedidoDeCambiarActivoDeNodo = (crudo: unknown) =>
  leerElPedido(FORMAS.cambiarActivo, crudo);
export const leerElPedidoDeClasificarProducto = (crudo: unknown) =>
  leerElPedido(FORMAS.clasificar, crudo);
