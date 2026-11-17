import { z } from "zod";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { decimal, identificador, leer } from "./entradas-de-facturacion";

/**
 * La entrada del cambio de precio de un producto (A1, T3): de lo que manda la pantalla a lo que acepta `cambiarPrecio`. Pura: sin base ni servidor.
 *
 * Lista de permitidos: del pedido solo se leen las claves que declara este esquema (`z.object` descarta el resto: no se puede mandar la empresa, la sucursal, la opción ni la
 * persona, que decide el servidor). Esta capa dice si el dato tiene la FORMA pedida; qué es un precio válido (texto decimal exacto, sin signo, hasta 6 decimales) lo decide la
 * primitiva dentro del caso de uso, y el importe sigue siendo TEXTO de punta a punta (ADR-006).
 *  - `precioId`: la clave de idempotencia del cambio; la fija la página al armarse, no el formulario, así el doble toque y el reintento mandan el mismo.
 *  - `precioIdEsperado`: la fila que la persona vio como vigente (`null`: no había ninguna). Con otra, el caso de uso rechaza sin escribir.
 * Chequeo: `entradas-de-precios-de-producto.test.ts`.
 */

const FORMA_DEL_PEDIDO = z.object({
  productoId: identificador,
  precioId: identificador,
  precioIdEsperado: identificador.nullable(),
  /** La forma (que sea texto y no sea enorme); el contenido lo decide la primitiva del precio. */
  precio: decimal,
});

export type PedidoDePrecio = z.output<typeof FORMA_DEL_PEDIDO>;

/** El pedido, o `"PEDIDO_INVALIDO"` si no tiene la forma pedida (sin decir cuál campo ni el valor recibido). */
export function leerElPedidoDePrecio(crudo: unknown): Resultado<PedidoDePrecio, "PEDIDO_INVALIDO"> {
  const forma = leer(FORMA_DEL_PEDIDO, crudo);
  return forma.ok ? forma : err("PEDIDO_INVALIDO");
}
