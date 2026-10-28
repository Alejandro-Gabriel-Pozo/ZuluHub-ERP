"use server";

import { altaDeEmpresaDeConsola } from "../../servidor/acciones-empresas";

// La acción del servidor del alta de empresa, expuesta a Next. Fina a propósito (como la de la web): la directiva
// `"use server"` tiene que ser lo primero de este archivo, así que lo que hace vive en
// `servidor/acciones-empresas.ts`. La entrada llega del navegador y se valida allá.

export async function altaDeEmpresaAccion(entrada: unknown) {
  return altaDeEmpresaDeConsola(entrada);
}
