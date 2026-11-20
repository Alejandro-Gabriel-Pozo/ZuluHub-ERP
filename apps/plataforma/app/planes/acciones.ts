"use server";

import {
  crearPlanDeConsola,
  guardarBorradorDeConsola,
  publicarVersionDeConsola,
} from "../../servidor/acciones-planes";

// Las acciones del servidor de la pantalla Planes, expuestas a Next. Finas a propósito: la directiva `"use server"` tiene que ser lo primero de este archivo,
// así que lo que hacen vive en `servidor/acciones-planes.ts`. La entrada llega del navegador y se valida allá.

export async function crearPlanAccion(entrada: unknown) {
  return crearPlanDeConsola(entrada);
}

export async function guardarBorradorAccion(entrada: unknown) {
  return guardarBorradorDeConsola(entrada);
}

export async function publicarVersionAccion(entrada: unknown) {
  return publicarVersionDeConsola(entrada);
}
