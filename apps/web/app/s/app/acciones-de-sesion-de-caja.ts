"use server";

import {
  abrirLaCajaDeLaSucursal,
  cancelarElCierreDeLaCaja,
  cerrarLaCajaConElArqueo,
  iniciarElCierreDeLaCaja,
} from "../../../servidor/sesion-de-caja";

// Las acciones de servidor de la pantalla «Caja» del mostrador (abrir, contar y cerrar), expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de
// este archivo, así que lo que hacen vive en `servidor/sesion-de-caja.ts`. Reciben el pedido tal como lo arma la pantalla (sin tipo: se lee y se valida en el servidor) y devuelven la
// respuesta ya traducida (ADR-016). La empresa, la persona y la sucursal no viajan: las decide el servidor. Las que escriben llevan la clave que generó la pantalla al abrir el formulario (repetirla no duplica); iniciar y cancelar el cierre y cerrar se resuelven por el estado de la sesión.

export async function abrirCajaAccion(entrada: unknown) {
  return abrirLaCajaDeLaSucursal(entrada);
}

export async function iniciarCierreDeCajaAccion(entrada: unknown) {
  return iniciarElCierreDeLaCaja(entrada);
}

export async function cancelarCierreDeCajaAccion(entrada: unknown) {
  return cancelarElCierreDeLaCaja(entrada);
}

export async function cerrarCajaAccion(entrada: unknown) {
  return cerrarLaCajaConElArqueo(entrada);
}
