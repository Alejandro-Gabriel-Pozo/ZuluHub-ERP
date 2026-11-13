import { z } from "zod";
import type { ClaseDeUso, EntradaDeEditarProducto, Producto } from "../modulos/catalogo/publico";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { entero, identificador, leer, texto } from "./entradas-de-facturacion";

/**
 * La entrada de la ficha de datos de un producto (A1, T2a): de lo que manda el formulario a lo que acepta `editarProducto`. Pura: sin base ni servidor.
 *
 * Lista de permitidos: del pedido solo se leen las claves que declara este esquema (`z.object` descarta el resto: no se puede mandar la clase, la unidad, la empresa ni el
 * estado), y la empresa y la persona las pone el servidor. Esta capa dice si el dato tiene la FORMA pedida; qué es un nombre, un código o una alícuota válidos lo decide el
 * dominio dentro de la transacción (largos y conjuntos viven una vez, en sus primitivas).
 *
 * Dos reglas que previenen perder datos en silencio, porque `editarProducto` reemplaza la ficha ENTERA (lo que no se manda queda vacío):
 *  - **Lo que el pedido no trae conserva lo guardado.** Un campo ausente (la pantalla no lo ofreció: una alícuota o una sección que no están entre las opciones, o la
 *    descripción, que esta pantalla no edita) toma el valor que el producto ya tiene; uno que llega vacío lo borra a propósito.
 *  - **Lo que la clase no admite va vacío.** Una clase que no se vende (materia prima, insumo, elaborado) no lleva nombre de cocina, descripción, alícuota ni sección: aunque
 *    el pedido los traiga, no se mandan.
 * Chequeo: `entradas-de-ficha-de-producto.test.ts`.
 */

/** Las clases que se venden: llevan nombre de cocina, descripción, alícuota y sección (decisión 131, `clases.ts` del módulo; el módulo no exporta esta pregunta). */
export const CLASES_QUE_SE_VENDEN: readonly ClaseDeUso[] = ["REVENTA", "VENDIBLE"];

const opcional = z.string().max(1000).optional();

const FORMA_DEL_PEDIDO = z.object({
  productoId: identificador,
  versionEsperada: entero,
  nombre: texto,
  nombreDeCocina: opcional,
  codigo: opcional,
  codigoDeBarras: opcional,
  alicuota: opcional,
  seccionDeCartaId: opcional,
});

/** Lo que pide la pantalla al guardar; un campo `undefined` es «no vino» (conserva lo guardado) y `""` es «vacío» (lo borra). */
export type PedidoDeLaFicha = z.output<typeof FORMA_DEL_PEDIDO>;

/** El pedido, o `"PEDIDO_INVALIDO"` si no tiene la forma pedida (sin decir cuál campo ni el valor recibido). */
export function leerElPedidoDeLaFicha(
  crudo: unknown,
): Resultado<PedidoDeLaFicha, "PEDIDO_INVALIDO"> {
  const forma = leer(FORMA_DEL_PEDIDO, crudo);
  return forma.ok ? forma : err("PEDIDO_INVALIDO");
}

/** Lo que de un producto hace falta para armar el pedido al caso de uso. */
export type ProductoParaEditar = Pick<
  Producto,
  | "id"
  | "claseDeUso"
  | "nombreDeCocina"
  | "descripcionEnCarta"
  | "codigo"
  | "codigoDeBarras"
  | "alicuota"
  | "seccionDeCartaId"
>;

/** El pedido a `editarProducto`: ver arriba las dos reglas. El nombre siempre viene del pedido (es el dato obligatorio de la pantalla). */
export function entradaDeEditarProducto(
  pedido: PedidoDeLaFicha,
  actual: ProductoParaEditar,
): EntradaDeEditarProducto {
  const vende = CLASES_QUE_SE_VENDEN.includes(actual.claseDeUso);
  return {
    productoId: actual.id,
    versionEsperada: pedido.versionEsperada,
    nombre: pedido.nombre,
    nombreDeCocina: vende ? (pedido.nombreDeCocina ?? actual.nombreDeCocina) : null,
    descripcionEnCarta: vende ? actual.descripcionEnCarta : null,
    codigo: pedido.codigo ?? actual.codigo,
    codigoDeBarras: pedido.codigoDeBarras ?? actual.codigoDeBarras,
    alicuota: vende ? (pedido.alicuota ?? actual.alicuota) : null,
    seccionDeCartaId: vende ? (pedido.seccionDeCartaId ?? actual.seccionDeCartaId) : null,
  };
}
