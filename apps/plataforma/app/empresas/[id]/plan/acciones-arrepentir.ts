"use server";

import { arrepentirCambioDeConsola } from "../../../../servidor/acciones-plan";

// La acción del servidor de «deshacer por arrepentimiento», expuesta a Next. Fina a propósito: la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hace vive en
// `servidor/acciones-plan.ts`. Va en su propio archivo para no tocar el de las demás acciones de la pantalla. La entrada llega del navegador y se valida allá.

export async function arrepentirCambioAccion(entrada: unknown) {
  return arrepentirCambioDeConsola(entrada);
}
