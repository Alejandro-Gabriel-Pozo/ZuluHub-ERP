"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  agregarLaPresentacion,
  cambiarElEstadoDeLaPresentacionDelProducto,
  guardarElNombreDeLaPresentacion,
} from "../../../servidor/presentaciones";

// Las acciones de servidor de las presentaciones de un producto, expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo
// que hacen vive en `servidor/presentaciones.ts`. Reciben el estado anterior que pasa `useActionState`. El producto, la presentación y su versión se ligan con `.bind` al armar la página: Next los cifra,
// no viajan en un campo. La empresa y la persona no viajan: las decide el servidor.

export async function crearPresentacionAccion(
  productoId: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return agregarLaPresentacion(productoId, datos);
}

export async function renombrarPresentacionAccion(
  productoId: string,
  presentacionId: string,
  versionEsperada: number,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return guardarElNombreDeLaPresentacion(productoId, presentacionId, versionEsperada, datos);
}

/** «Desactivar» (`activa: false`) y «Reactivar» (`activa: true`): sin campos; la presentación, su versión y el sentido los fija la página. */
export async function cambiarElEstadoDeLaPresentacionAccion(
  productoId: string,
  presentacionId: string,
  versionEsperada: number,
  activa: boolean,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return cambiarElEstadoDeLaPresentacionDelProducto(
    productoId,
    presentacionId,
    versionEsperada,
    activa,
  );
}
