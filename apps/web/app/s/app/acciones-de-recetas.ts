"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  confirmarLaReceta,
  guardarLaRecetaDelFormulario,
  type LigadoDeLaReceta,
  type ResultadoDeLaConfirmacion,
} from "../../../servidor/recetas";

// Las acciones de servidor de «Recetas» (guardar), expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen
// vive en `servidor/recetas.ts`. Guardar recibe el estado anterior que pasa `useActionState`. El producto (al editar), la versión que se vio y la unidad de cada ingrediente se ligan con `.bind` al
// armar la página; la empresa y la persona no viajan: las decide el servidor.

export async function guardarRecetaAccion(
  ligado: LigadoDeLaReceta,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return guardarLaRecetaDelFormulario(ligado, datos);
}

/** Calcula lo que se muestra antes de guardar (no guarda nada). */
export async function confirmarRecetaAccion(
  ligado: LigadoDeLaReceta,
  datos: FormData,
): Promise<ResultadoDeLaConfirmacion> {
  return confirmarLaReceta(ligado, datos);
}
