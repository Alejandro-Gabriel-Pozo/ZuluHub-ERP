"use server";

import { cambiarPlanDeConsola } from "../../../../servidor/acciones-plan";

// La acción del servidor de la pantalla Plan de una empresa, expuesta a Next. Fina a propósito: la directiva
// `"use server"` tiene que ser lo primero de este archivo, así que lo que hace vive en
// `servidor/acciones-plan.ts`. La entrada llega del navegador y se valida allá.

export async function cambiarPlanAccion(entrada: unknown) {
  return cambiarPlanDeConsola(entrada);
}
