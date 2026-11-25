"use server";

import {
  activarDominioDeConsola,
  agregarDominioDeConsola,
  desactivarDominioDeConsola,
  retirarDominioDeConsola,
  verificarDominioDeConsola,
} from "../../servidor/acciones-dominios";

// Las acciones del servidor de la pantalla Dominios, expuestas a Next. Finas a propósito: la directiva `"use server"` tiene que ser lo primero de este archivo, así
// que lo que hacen vive en `servidor/acciones-dominios.ts`. La entrada llega del navegador y se valida allá.

export async function agregarDominioAccion(entrada: unknown) {
  return agregarDominioDeConsola(entrada);
}

export async function verificarDominioAccion(entrada: unknown) {
  return verificarDominioDeConsola(entrada);
}

export async function activarDominioAccion(entrada: unknown) {
  return activarDominioDeConsola(entrada);
}

export async function desactivarDominioAccion(entrada: unknown) {
  return desactivarDominioDeConsola(entrada);
}

export async function retirarDominioAccion(entrada: unknown) {
  return retirarDominioDeConsola(entrada);
}
