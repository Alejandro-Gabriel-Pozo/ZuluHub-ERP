"use server";

import {
  invitarAUnUsuario,
  reenviarUnaInvitacion,
  revocarUnaInvitacion,
} from "../../../servidor/usuarios";
import type {
  ResultadoDeAccionDeInvitacion,
  ResultadoDeInvitar,
} from "../../../ui/plantillas/usuarios/resultado-de-usuarios";

// Las acciones de servidor de «Usuarios» (tramo U2), expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen
// vive en `servidor/usuarios.ts`. Reciben el estado anterior que pasa `useActionState`. El id de la invitación se liga con `.bind` al armar la página (Next lo cifra): nunca va en el formulario. La
// empresa y la persona que actúa no viajan: las decide el servidor. Ninguna redirige: dicen adónde ir y la pantalla navega.

export async function invitarUsuarioAccion(
  previo: ResultadoDeInvitar,
  datos: FormData,
): Promise<ResultadoDeInvitar> {
  void previo;
  return invitarAUnUsuario(datos);
}

export async function reenviarInvitacionAccion(
  invitacionId: string,
  previo: ResultadoDeAccionDeInvitacion,
  datos: FormData,
): Promise<ResultadoDeAccionDeInvitacion> {
  void previo;
  void datos;
  return reenviarUnaInvitacion(invitacionId);
}

export async function revocarInvitacionAccion(
  invitacionId: string,
  previo: ResultadoDeAccionDeInvitacion,
  datos: FormData,
): Promise<ResultadoDeAccionDeInvitacion> {
  void previo;
  void datos;
  return revocarUnaInvitacion(invitacionId);
}
