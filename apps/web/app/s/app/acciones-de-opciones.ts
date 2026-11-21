"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import { copiarLasOpciones, guardarElGrupo } from "../../../servidor/opciones";

// Las acciones de servidor de las opciones de un producto, expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que
// lo que hacen vive en `servidor/opciones.ts`. Reciben el estado anterior que pasa `useActionState`. El producto, la versión de las opciones, el grupo, la clave del cambio y los ids de las
// opciones que se vieron se ligan con `.bind` al armar la página: Next los cifra, no viajan en un campo. La empresa y la persona no viajan: las decide el servidor.

export async function guardarGrupoAccion(
  productoId: string,
  versionDeOpciones: number,
  grupoId: string | null,
  claveDelCambio: string,
  idsDeOpciones: readonly string[],
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return guardarElGrupo(
    { productoId, versionDeOpciones, grupoId, claveDelCambio, idsDeOpciones },
    datos,
  );
}

export async function copiarOpcionesAccion(
  productoId: string,
  versionDeOpciones: number,
  claveDeLaCopia: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return copiarLasOpciones(productoId, versionDeOpciones, claveDeLaCopia, datos);
}
