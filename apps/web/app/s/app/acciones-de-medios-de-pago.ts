"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  agregarElMedio,
  desactivarElMedio,
  editarElMedio,
  reactivarElMedio,
} from "../../../servidor/medios-de-pago";

// Las acciones de servidor de «Medios de pago», expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de
// este archivo, así que lo que hacen vive en `servidor/medios-de-pago.ts`. Las de formulario reciben el estado anterior que pasa `useActionState`. El id (y la
// versión) del medio se ligan con `.bind` al armar la página: Next los cifra, no viajan en un campo. La empresa y la persona no viajan: las decide el servidor.

export async function agregarMedioAccion(
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return agregarElMedio(datos);
}

export async function editarMedioAccion(
  medioDePagoId: string,
  versionEsperada: number,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return editarElMedio(medioDePagoId, versionEsperada, datos);
}

export async function desactivarMedioAccion(
  medioDePagoId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return desactivarElMedio(medioDePagoId);
}

export async function reactivarMedioAccion(
  medioDePagoId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return reactivarElMedio(medioDePagoId);
}
