import { z } from "zod";
import { decimal, identificador, leer, type ErrorDeEntrada } from "./entradas-de-facturacion";
import type { Resultado } from "../primitivas/resultado/resultado";

/**
 * La frontera de la venta rápida (mostrador): de lo que manda el navegador (el carrito) a lo que recibe `cotizarVentaRapida`. Solo se toma lo que el esquema declara: la empresa, la persona y
 * la SUCURSAL no se leen del pedido (las pone el servidor; el caso la vuelve a validar contra el alcance) y cualquier otra clave se descarta. Cantidades e importes llegan como TEXTO decimal (ADR-006),
 * nunca como número; esta capa solo dice si el dato tiene la FORMA pedida: si la cantidad es válida y múltiplo del paso, si el producto se vende o si una opción corresponde, lo decide el
 * servidor dentro de su transacción. Los topes son de forma (un pedido enorme no llega a la base): el de líneas es el de `venderYCobrar` (`vender-y-cobrar.ts`, `MAXIMO_DE_LINEAS`).
 */

export const MAXIMO_DE_LINEAS_DEL_CARRITO = 200;
export const MAXIMO_DE_OPCIONES_POR_LINEA = 50;

const linea = z.object({
  productoId: identificador,
  varianteId: identificador.optional(),
  opcionIds: z.array(identificador).max(MAXIMO_DE_OPCIONES_POR_LINEA),
  cantidad: decimal,
  /** Solo para un producto en precio abierto (decisión 179): el servidor rechaza uno si el catálogo trae precio. */
  precioAbierto: decimal.optional(),
});

const formaDelCarrito = z.object({ lineas: z.array(linea).max(MAXIMO_DE_LINEAS_DEL_CARRITO) });

export type EntradaWebDeCotizarElCarrito = z.infer<typeof formaDelCarrito>;

export function entradaDeCotizarElCarrito(
  crudo: unknown,
): Resultado<EntradaWebDeCotizarElCarrito, ErrorDeEntrada> {
  return leer(formaDelCarrito, crudo);
}
