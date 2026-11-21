"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  agregarLaImpresora,
  cambiarLaImpresora,
  quitarLaImpresora,
} from "../../../servidor/impresoras";

// Las acciones de servidor de las impresoras del salón, expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen vive en
// `servidor/impresoras.ts`. Las de formulario reciben el estado anterior que pasa `useActionState`. El id de la impresora y su versión se ligan con `.bind` al armar la página: Next los cifra, no viajan en un campo. La
// empresa, la persona y la sucursal no viajan: las decide el servidor.

/** El alta: el id de la impresora (la clave del intento) lo liga la página con `.bind`. */
export async function crearImpresoraAccion(
  impresoraId: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return agregarLaImpresora(impresoraId, datos);
}

/** Editar: la impresora y la versión que se vio las liga la página con `.bind`. */
export async function editarImpresoraAccion(
  impresoraId: string,
  versionEsperada: number,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return cambiarLaImpresora(impresoraId, versionEsperada, datos);
}

export async function quitarImpresoraAccion(
  impresoraId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return quitarLaImpresora(impresoraId);
}
