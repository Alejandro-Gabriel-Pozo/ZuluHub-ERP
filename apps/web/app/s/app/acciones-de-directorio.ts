"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  desactivarLaParteDelDirectorio,
  guardarLaParteDelFormulario,
  reactivarLaParteDelDirectorio,
  type ResultadoDeGuardarLaParte,
} from "../../../servidor/directorio";

// Las acciones de servidor de «Clientes y proveedores», expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo
// que hacen vive en `servidor/directorio.ts`. Las de formulario reciben el estado anterior que pasa `useActionState`. La clave de creación, la parte y su versión se ligan con `.bind` al armar
// la página: Next los cifra, no viajan en un campo. La empresa y la persona no viajan: las decide el servidor. NO redirigen (un `redirect` dentro de una acción pierde el host): la pantalla navega.

/**
 * Los roles salen SOLO de las dos casillas: un `roles` escrito a mano en el formulario se descarta. Marcada manda `on`; desmarcada no manda nada (lo de siempre de una casilla).
 */
function conLosRolesDeLasCasillas(datos: FormData): void {
  datos.delete("roles");
  if (datos.get("rolCliente") === "on") datos.append("roles", "CUSTOMER");
  if (datos.get("rolProveedor") === "on") datos.append("roles", "PROVEEDOR");
}

/** El alta: la clave de creación la liga la página con `.bind` y pisa cualquier `idempotencia` que venga en el formulario. */
export async function crearParteAccion(
  claveDeCreacion: string,
  previo: ResultadoDeGuardarLaParte,
  datos: FormData,
): Promise<ResultadoDeGuardarLaParte> {
  void previo;
  datos.set("idempotencia", claveDeCreacion);
  conLosRolesDeLasCasillas(datos);
  return guardarLaParteDelFormulario(null, null, datos);
}

/** Editar: la parte y la versión que se vio las liga la página con `.bind`. */
export async function editarParteAccion(
  parteId: string,
  versionEsperada: number,
  claveDeEnvio: string,
  previo: ResultadoDeGuardarLaParte,
  datos: FormData,
): Promise<ResultadoDeGuardarLaParte> {
  void previo;
  datos.set("idempotencia", claveDeEnvio);
  conLosRolesDeLasCasillas(datos);
  return guardarLaParteDelFormulario(parteId, versionEsperada, datos);
}

export async function desactivarParteAccion(
  parteId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return desactivarLaParteDelDirectorio(parteId);
}

export async function reactivarParteAccion(
  parteId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return reactivarLaParteDelDirectorio(parteId);
}
