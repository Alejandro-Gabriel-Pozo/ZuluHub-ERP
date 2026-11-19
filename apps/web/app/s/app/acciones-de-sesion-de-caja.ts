"use server";

import { abrirLaCajaDeLaSucursal } from "../../../servidor/sesion-de-caja";

// Las acciones de servidor de la pantalla «Caja» del mostrador (hoy, abrir), expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de
// este archivo, así que lo que hacen vive en `servidor/sesion-de-caja.ts`. Reciben el pedido tal como lo arma la pantalla (sin tipo: se lee y se valida en el servidor) y devuelven la
// respuesta ya traducida (ADR-016). La empresa, la persona y la sucursal no viajan: las decide el servidor. Abrir lleva la clave que generó la pantalla al abrir el formulario (repetirla no duplica).

export async function abrirCajaAccion(entrada: unknown) {
  return abrirLaCajaDeLaSucursal(entrada);
}
