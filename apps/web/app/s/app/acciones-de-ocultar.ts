"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import { ocultarOMostrar, volverAMostrar } from "../../../servidor/ocultar";

// Las acciones de servidor de «Ocultar» (A15), expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que
// hacen vive en `servidor/ocultar.ts`. Reciben el estado anterior que pasa `useActionState`. El producto, el alcance y el ESTADO que se quiere (ocultar o volver a mostrar) los liga la página con
// `.bind` al armar la tarjeta (Next los cifra, no viajan en un campo); la empresa, la persona y el local los decide el servidor. Repetirla da el mismo estado: no duplica ni deshace.

export async function ocultarOMostrarAccion(
  productoId: string,
  alcance: "LOCAL" | "EMPRESA",
  oculto: boolean,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  void datos;
  return ocultarOMostrar(productoId, alcance, oculto);
}

/** «Volver a mostrar» de la lista de ocultos (C2): el producto lo liga la página con `.bind`; dónde está oculto y con qué permiso lo decide el servidor. */
export async function volverAMostrarAccion(
  productoIds: readonly string[],
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  void datos;
  return volverAMostrar(productoIds);
}
