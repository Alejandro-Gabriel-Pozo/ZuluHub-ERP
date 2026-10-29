"use server";

import {
  activarElPuntoDeVenta,
  crearElPuntoDeVenta,
  desactivarElPuntoDeVenta,
  editarElPuntoDeVenta,
} from "../../../servidor/configuracion-fiscal";

// Las acciones de servidor de Puntos de venta, expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"`
// tiene que ser lo primero de este archivo, así que lo que hacen vive en `servidor/configuracion-fiscal.ts` (que empieza con
// `server-only`). Reciben el pedido tal como lo arma la pantalla (sin tipo: se lee y se valida en el servidor) y devuelven la
// respuesta ya traducida (ADR-016). La empresa y quién actúa no viajan: los decide el servidor. El cambio de ambiente es
// `cambiarAmbienteAccion`, de `acciones-de-facturacion.ts`.

export async function crearPuntoDeVentaAccion(entrada: unknown) {
  return crearElPuntoDeVenta(entrada);
}

export async function editarPuntoDeVentaAccion(entrada: unknown) {
  return editarElPuntoDeVenta(entrada);
}

export async function activarPuntoDeVentaAccion(entrada: unknown) {
  return activarElPuntoDeVenta(entrada);
}

export async function desactivarPuntoDeVentaAccion(entrada: unknown) {
  return desactivarElPuntoDeVenta(entrada);
}
