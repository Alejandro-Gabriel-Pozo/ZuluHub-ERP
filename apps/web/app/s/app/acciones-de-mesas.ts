"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  cambiarElEstadoDeLaMesaDelSalon,
  darDeAltaLaMesa,
  guardarLaMesa,
} from "../../../servidor/salon";

// Las acciones de servidor de las mesas del salón, expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo
// que hacen vive en `servidor/salon.ts`. Las de formulario reciben el estado anterior que pasa `useActionState`. La clave de creación, la mesa y su versión se ligan con `.bind` al armar la
// página: Next los cifra, no viajan en un campo. La empresa, la persona y la sucursal no viajan: las decide el servidor.

/** El alta: la clave de creación la liga la página con `.bind`. */
export async function crearMesaAccion(
  claveDeCreacion: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return darDeAltaLaMesa(claveDeCreacion, datos);
}

/** Editar: la mesa y la versión que se vio las liga la página con `.bind`. */
export async function editarMesaAccion(
  mesaId: string,
  versionEsperada: number,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return guardarLaMesa(mesaId, versionEsperada, datos);
}

export async function desactivarMesaAccion(
  mesaId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return cambiarElEstadoDeLaMesaDelSalon(mesaId, false);
}

export async function reactivarMesaAccion(
  mesaId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return cambiarElEstadoDeLaMesaDelSalon(mesaId, true);
}
