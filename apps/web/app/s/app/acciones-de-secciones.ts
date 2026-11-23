"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  agregarElProductoALaSeccion,
  cambiarElEstadoDeLaSeccionDeCarta,
  darDeAltaLaSeccion,
  guardarElNombreDeLaSeccion,
  moverLaSeccion,
  quitarElProductoDeLaSeccion,
} from "../../../servidor/secciones";
import type {
  VistaDeProducto,
  VistaDeSeccion,
} from "../../../ui/plantillas/catalogo/modelo-de-secciones";

// Las acciones de servidor de las secciones de la carta, expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo
// que hacen vive en `servidor/secciones.ts`. Las de formulario reciben el estado anterior que pasa `useActionState`. La clave de creación, la sección, su versión y las secciones activas que la
// persona vio se ligan con `.bind` al armar la página: Next los cifra, no viajan en un campo. La empresa y la persona no viajan: las decide el servidor.

/** El alta: la clave de creación la liga la página con `.bind`. */
export async function crearSeccionAccion(
  claveDeCreacion: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return darDeAltaLaSeccion(claveDeCreacion, datos);
}

/** Renombrar: la sección y la versión que se vio las liga la página con `.bind`. */
export async function renombrarSeccionAccion(
  seccionId: string,
  versionEsperada: number,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return guardarElNombreDeLaSeccion(seccionId, versionEsperada, datos);
}

/** Una flecha: las activas que se vieron, en su orden y con su versión, las liga la página con `.bind`; el formulario trae la sección tocada. */
export async function moverSeccionAccion(
  vistas: readonly VistaDeSeccion[],
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return moverLaSeccion(vistas, datos);
}

export async function desactivarSeccionAccion(
  seccionId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return cambiarElEstadoDeLaSeccionDeCarta(seccionId, false);
}

export async function reactivarSeccionAccion(
  seccionId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return cambiarElEstadoDeLaSeccionDeCarta(seccionId, true);
}

/** «Quitar»: la sección y los productos que se vieron, con su versión, los liga la página con `.bind`; el formulario trae el producto tocado. */
export async function quitarProductoDeSeccionAccion(
  seccionId: string,
  vistas: readonly VistaDeProducto[],
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return quitarElProductoDeLaSeccion(seccionId, vistas, datos);
}

/** «Agregar producto»: la sección y los candidatos que se vieron, con su versión, los liga la página con `.bind`; el formulario trae el candidato elegido. */
export async function agregarProductoASeccionAccion(
  seccionId: string,
  vistas: readonly VistaDeProducto[],
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return agregarElProductoALaSeccion(seccionId, vistas, datos);
}
