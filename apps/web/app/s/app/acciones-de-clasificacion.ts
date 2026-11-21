"use server";

import {
  clasificarElProducto,
  crearElNodoDeClasificacion,
  desactivarElNodoDeClasificacion,
  moverElNodoDeClasificacion,
  reactivarElNodoDeClasificacion,
  renombrarElNodoDeClasificacion,
} from "../../../servidor/clasificacion";

// Las acciones de servidor de la clasificación comercial, expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que
// hacen vive en `servidor/clasificacion.ts` (que empieza con `server-only`). Reciben el pedido tal como lo arma la pantalla (sin tipo: se lee y se valida en el servidor) y devuelven la respuesta ya
// traducida (ADR-016). La empresa y quién actúa no viajan: los decide el servidor. Cada una declara cómo se repite sin duplicar: crear y clasificar llevan la clave que fijó la pantalla al abrir la
// hoja; renombrar y mover, la versión que se vio; desactivar y reactivar dicen `yaEstaba`.

export async function crearNodoDeClasificacionAccion(entrada: unknown) {
  return crearElNodoDeClasificacion(entrada);
}

export async function renombrarNodoDeClasificacionAccion(entrada: unknown) {
  return renombrarElNodoDeClasificacion(entrada);
}

export async function moverNodoDeClasificacionAccion(entrada: unknown) {
  return moverElNodoDeClasificacion(entrada);
}

export async function desactivarNodoDeClasificacionAccion(entrada: unknown) {
  return desactivarElNodoDeClasificacion(entrada);
}

export async function reactivarNodoDeClasificacionAccion(entrada: unknown) {
  return reactivarElNodoDeClasificacion(entrada);
}

export async function clasificarProductoAccion(entrada: unknown) {
  return clasificarElProducto(entrada);
}
