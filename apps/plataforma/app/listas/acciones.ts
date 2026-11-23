"use server";

import {
  agregarValorDeConsola,
  corregirNombreDeConsola,
  desactivarValorDeConsola,
  reactivarValorDeConsola,
} from "../../servidor/acciones-listas";

// Las acciones del servidor de la pantalla Listas, expuestas a Next. Finas a propósito: la directiva `"use server"` tiene que ser lo primero de este archivo, así
// que lo que hacen vive en `servidor/acciones-listas.ts`. La entrada llega del navegador y se valida allá.

export async function agregarValorAccion(entrada: unknown) {
  return agregarValorDeConsola(entrada);
}

export async function corregirNombreAccion(entrada: unknown) {
  return corregirNombreDeConsola(entrada);
}

export async function desactivarValorAccion(entrada: unknown) {
  return desactivarValorDeConsola(entrada);
}

export async function reactivarValorAccion(entrada: unknown) {
  return reactivarValorDeConsola(entrada);
}
