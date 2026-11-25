import { z } from "zod";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { decimal, identificador, leer } from "./entradas-de-facturacion";

/**
 * La entrada de los precios por medida de un producto (A13, tramo Medidas): de lo que manda la pantalla a lo que entiende la composición. Pura: sin base ni servidor.
 *
 * Lista de permitidos: solo se leen las claves que declara el esquema (la empresa, la sucursal y la persona no se pueden mandar). `claveDelCambio` y `precioIdEsperado` los fija la
 * página al armarse (no viajan en el formulario); el precio sigue siendo TEXTO (ADR-006) y qué es un precio válido lo decide la primitiva dentro del caso de uso.
 * Chequeo: `entradas-de-precios-por-medida.test.ts`.
 */

/** Cuántas medidas admite un pedido: una cota de forma para no leer algo enorme (las reglas de negocio las pone el dominio). */
const MAXIMO_DE_MEDIDAS_POR_PEDIDO = 100;

const FORMA_DEL_PEDIDO = z.object({
  productoId: identificador,
  claveDelCambio: identificador,
  filas: z
    .array(
      z.object({
        opcionId: identificador,
        /** La fila que la persona vio como vigente para esa medida (`null`: no tenía precio). */
        precioIdEsperado: identificador.nullable(),
        /** Lo que escribió; vacío = no toca esa medida. */
        precio: decimal,
      }),
    )
    .max(MAXIMO_DE_MEDIDAS_POR_PEDIDO),
});

export type PedidoDePreciosPorMedida = z.output<typeof FORMA_DEL_PEDIDO>;

/** El pedido, o `"PEDIDO_INVALIDO"` si no tiene la forma pedida (sin decir cuál campo ni el valor recibido). */
export function leerElPedidoDePreciosPorMedida(
  crudo: unknown,
): Resultado<PedidoDePreciosPorMedida, "PEDIDO_INVALIDO"> {
  const forma = leer(FORMA_DEL_PEDIDO, crudo);
  return forma.ok ? forma : err("PEDIDO_INVALIDO");
}

const CAMPO_DE_PRECIO = /^precio_(\d{1,3})$/;

/**
 * Los precios que mandó el formulario por posición de medida: `precio_<i>` con i la posición ligada por la página. Lo que no es un campo `precio_<i>`, no es texto o apunta más allá de
 * lo ligado no se lee. Una medida que no mandó nada trae el texto vacío (no se toca).
 */
export function leerLosPreciosDelFormulario(
  campos: Iterable<readonly [string, unknown]>,
  cantidad: number,
): readonly string[] {
  const precios = Array.from({ length: cantidad }, () => "");
  const vistos = new Set<number>();
  for (const [nombre, valor] of campos) {
    const partes = CAMPO_DE_PRECIO.exec(nombre);
    if (partes === null || typeof valor !== "string") continue;
    const i = Number(partes[1]);
    if (i >= cantidad || vistos.has(i)) continue;
    vistos.add(i);
    precios[i] = valor;
  }
  return precios;
}

/** Cómo se llama el campo del precio de la medida en la posición `i`. */
export const nombreDeCampoDePrecio = (i: number): string => `precio_${String(i)}`;
