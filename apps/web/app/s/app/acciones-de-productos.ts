"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import { guardarLaFicha } from "../../../servidor/ficha-de-producto";

// Las acciones de servidor de los productos, expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que
// lo que hacen vive en `servidor/ficha-de-producto.ts`. Las de formulario reciben el estado anterior que pasa `useActionState`. El id y la versión del producto se ligan con
// `.bind` al armar la página: Next los cifra, no viajan en un campo. La empresa y la persona no viajan: las decide el servidor.

export async function guardarFichaAccion(
  productoId: string,
  versionEsperada: number,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return guardarLaFicha(productoId, versionEsperada, datos);
}
