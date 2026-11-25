"use server";

import { definirPoliticaDeConsola } from "../../servidor/acciones-politica";

// La acción del servidor de la pantalla «Política de cambio de plan», expuesta a Next. Fina a propósito: la directiva `"use server"` tiene que ser lo primero de este archivo,
// así que lo que hace vive en `servidor/acciones-politica.ts`. La entrada llega del navegador y se valida allá.

export async function definirPoliticaAccion(entrada: unknown) {
  return definirPoliticaDeConsola(entrada);
}
