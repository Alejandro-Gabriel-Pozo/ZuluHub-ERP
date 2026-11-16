"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import { darDeAltaElProducto } from "../../../servidor/alta-de-producto";
import { guardarLaFicha } from "../../../servidor/ficha-de-producto";
import { cambiarElPrecio } from "../../../servidor/precios-de-producto";
import { cambiarLosPreciosDeLasMedidas } from "../../../servidor/precios-por-medida";

// Las acciones de servidor de los productos, expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que
// lo que hacen vive en `servidor/ficha-de-producto.ts`, `servidor/precios-de-producto.ts` y `servidor/alta-de-producto.ts`. Las de formulario reciben el estado anterior que pasa `useActionState`. El id y la
// versión del producto (y, en el precio, la clave del cambio y la fila vista; en el alta, la clave de creación) se ligan con `.bind` al armar la página: Next los cifra, no viajan en un campo. La
// empresa y la persona no viajan: las decide el servidor.

export async function guardarFichaAccion(
  productoId: string,
  versionEsperada: number,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return guardarLaFicha(productoId, versionEsperada, datos);
}

export async function cambiarPrecioAccion(
  productoId: string,
  precioId: string,
  precioIdEsperado: string | null,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return cambiarElPrecio(productoId, precioId, precioIdEsperado, datos);
}

/** El alta: la clave de creación la liga la página con `.bind` (cifrada, no viaja en un campo); la empresa y la persona las decide el servidor. */
export async function crearProductoAccion(
  claveDeCreacion: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return darDeAltaElProducto(claveDeCreacion, datos);
}

/** Los precios por medida: el producto, la clave del cambio y, por medida, su id y la fila vista los liga la página con `.bind`; del formulario solo vienen los precios. */
export async function cambiarPreciosPorMedidaAccion(
  productoId: string,
  claveDelCambio: string,
  medidas: readonly Readonly<{ opcionId: string; precioIdEsperado: string | null }>[],
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return cambiarLosPreciosDeLasMedidas({ productoId, claveDelCambio, medidas }, datos);
}
