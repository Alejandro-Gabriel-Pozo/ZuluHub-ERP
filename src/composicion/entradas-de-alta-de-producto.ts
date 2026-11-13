import { z } from "zod";
import type { EntradaDeCrearProducto } from "../modulos/catalogo/publico";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { identificador, leer, texto } from "./entradas-de-facturacion";
import { CLASES_QUE_SE_VENDEN } from "./entradas-de-ficha-de-producto";

/**
 * La entrada del alta de un producto (A1, T6): de lo que manda el formulario a lo que acepta `crearProducto`. Pura: sin base ni servidor.
 *
 * Lista de permitidos: del pedido solo se leen las claves que declara este esquema (`z.object` descarta el resto: no se puede mandar la empresa, la persona, la descripción, la unidad
 * de venta ni el paso mínimo), y la empresa y la persona las pone el servidor. Esta capa dice si el dato tiene la FORMA pedida; qué es una clase, una unidad, un nombre, un código o
 * una alícuota válidos lo decide el dominio dentro de la transacción (largos y conjuntos viven una vez, en sus primitivas).
 *
 * Tres reglas:
 *  - **La clave de creación es el `id` del producto** (idempotencia del alta: el mismo `id` y el mismo contenido devuelven el producto ya creado, sin duplicar). La fija la página, no
 *    el navegador: viaja ligada a la acción, no en un campo.
 *  - **Lo que la clase no admite va vacío**: una clase que no se vende no lleva nombre de cocina, alícuota ni sección; aunque el pedido los traiga, no se mandan (el servidor los
 *    rechazaría). Es la misma regla que la ficha de datos (`CLASES_QUE_SE_VENDEN`, una sola fuente).
 *  - **Nace por unidad y paso 1, sin descripción**: la forma de venta no se manda (el caso de uso toma la unidad base y paso 1; la maqueta aprobada dice que al crear no se elige) y la
 *    descripción no entra en la pantalla (dueño, 13/11/2026).
 * Chequeo: `entradas-de-alta-de-producto.test.ts`.
 */

const FORMA_DEL_PEDIDO = z.object({
  claveDeCreacion: identificador,
  claseDeUso: texto,
  unidadBaseId: texto,
  nombre: texto,
  nombreDeCocina: texto,
  codigo: texto,
  codigoDeBarras: texto,
  alicuota: texto,
  seccionDeCartaId: texto,
});

/** Lo que pide la pantalla al crear; un campo vacío es «no tiene». */
export type PedidoDeAlta = z.output<typeof FORMA_DEL_PEDIDO>;

/** El pedido, o `"PEDIDO_INVALIDO"` si no tiene la forma pedida (sin decir cuál campo ni el valor recibido). */
export function leerElPedidoDeAlta(crudo: unknown): Resultado<PedidoDeAlta, "PEDIDO_INVALIDO"> {
  const forma = leer(FORMA_DEL_PEDIDO, crudo);
  return forma.ok ? forma : err("PEDIDO_INVALIDO");
}

/** El pedido a `crearProducto`: ver arriba las reglas. */
export function entradaDeCrearProducto(pedido: PedidoDeAlta): EntradaDeCrearProducto {
  const vende = (CLASES_QUE_SE_VENDEN as readonly string[]).includes(pedido.claseDeUso);
  return {
    id: pedido.claveDeCreacion,
    claseDeUso: pedido.claseDeUso,
    unidadBaseId: pedido.unidadBaseId,
    nombre: pedido.nombre,
    nombreDeCocina: vende ? pedido.nombreDeCocina : null,
    codigo: pedido.codigo,
    codigoDeBarras: pedido.codigoDeBarras,
    alicuota: vende ? pedido.alicuota : null,
    seccionDeCartaId: vende ? pedido.seccionDeCartaId : null,
  };
}
