"use server";

import { guardarElNivelDeLaPantalla } from "../../../servidor/nivel-de-compras";
import type { ResultadoDeGuardarElNivel } from "../../../ui/plantillas/compras/nivel/resultado-de-nivel";

// La acción de servidor de «Nivel de compras» (Compras PR 11), expuesta a Next. Fina a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que
// hace vive en `servidor/nivel-de-compras.ts`. La versión que se vio la liga el formulario (la lleva el componente, no un campo del formulario). La empresa y la persona no viajan: las decide el servidor.

export async function guardarNivelDeComprasAccion(
  versionVista: number,
  previo: ResultadoDeGuardarElNivel,
  datos: FormData,
): Promise<ResultadoDeGuardarElNivel> {
  void previo;
  return guardarElNivelDeLaPantalla(versionVista, datos);
}
