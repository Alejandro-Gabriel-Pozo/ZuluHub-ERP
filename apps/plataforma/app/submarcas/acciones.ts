"use server";

import {
  confirmarVersionDeSubmarcaDeConsola,
  guardarBorradorDeSubmarcaDeConsola,
} from "../../servidor/acciones-submarcas";

// Las acciones del servidor de la pantalla Submarca, expuestas a Next. Finas a propósito: la directiva
// `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen vive en
// `servidor/acciones-submarcas.ts`. La entrada llega del navegador y se valida allá.

export async function guardarBorradorAccion(entrada: unknown) {
  return guardarBorradorDeSubmarcaDeConsola(entrada);
}

export async function confirmarVersionAccion(entrada: unknown) {
  return confirmarVersionDeSubmarcaDeConsola(entrada);
}
