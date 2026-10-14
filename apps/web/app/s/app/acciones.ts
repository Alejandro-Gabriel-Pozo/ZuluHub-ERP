"use server";

import {
  aceptarLaInvitacion,
  cerrarLaSesion,
  entrarALaEmpresa,
  ingresarConGoogle,
  type ResultadoDeAccion,
} from "../../../servidor/acciones";

// Las acciones del servidor de sesión y empresa, expuestas a Next. Finas a propósito (ADR-015, punto 2): la
// directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen vive en
// `servidor/acciones.ts` (que empieza con `server-only` y se prueba aparte). Las de formulario reciben el
// estado anterior que pasa `useActionState`.

export async function ingresarConGoogleAccion(
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return ingresarConGoogle(datos);
}

export async function entrarALaEmpresaAccion(
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return entrarALaEmpresa(datos);
}

export async function cerrarSesionAccion(previo: ResultadoDeAccion): Promise<ResultadoDeAccion> {
  void previo;
  return cerrarLaSesion();
}

/** Se usa con `.bind(null, token)`: Next cifra el token ligado, así no viaja en claro en la página. */
export async function aceptarInvitacionAccion(token: string, clave: string) {
  return aceptarLaInvitacion({ token, clave });
}
