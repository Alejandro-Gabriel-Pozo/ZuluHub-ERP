"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  abrirLaOrdenDelFormulario,
  anularLaOrdenDeLaFicha,
  cancelarLaOrdenDeLaFicha,
} from "../../../servidor/produccion";

// Las acciones de servidor de «Producción», expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que
// hacen vive en `servidor/produccion.ts`. Reciben el estado anterior que pasa `useActionState`. El id de la orden se liga con `.bind` al armar la página; la empresa, la persona y la
// sucursal no viajan: las decide el servidor.

export async function cancelarOrdenAccion(
  ordenId: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return cancelarLaOrdenDeLaFicha(ordenId, datos);
}

export async function anularOrdenAccion(
  ordenId: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return anularLaOrdenDeLaFicha(ordenId, datos);
}

/** Abre una orden. La clave de idempotencia se liga con `.bind` al armar la página (repetir el envío no duplica); la empresa, la persona, la sucursal, el depósito y la unidad no viajan: las decide el servidor. */
export async function abrirOrdenAccion(
  clave: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return abrirLaOrdenDelFormulario(clave, datos);
}
