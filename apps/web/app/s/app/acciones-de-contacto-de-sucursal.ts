"use server";

import { guardarElContactoDeLaSucursal } from "../../../servidor/contacto-de-sucursal";

// La acción de servidor de «Contacto de la sucursal», expuesta a Next. Fina a propósito (ADR-015, punto 2): la directiva `"use server"`
// tiene que ser lo primero de este archivo, así que lo que hace vive en `servidor/contacto-de-sucursal.ts` (que empieza con
// `server-only`). Recibe el pedido tal como lo arma la pantalla (sin tipo: se lee y se valida en el servidor) y devuelve la respuesta ya
// traducida (ADR-016). La empresa, la persona y la sucursal no viajan: las decide el servidor.

export async function guardarContactoDeSucursalAccion(entrada: unknown) {
  return guardarElContactoDeLaSucursal(entrada);
}
