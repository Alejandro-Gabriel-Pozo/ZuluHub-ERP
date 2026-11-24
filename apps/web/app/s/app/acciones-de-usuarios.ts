"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  guardarLasSucursalesDeUnEmpleado,
  invitarAUnUsuario,
  reenviarUnaInvitacion,
  revocarUnaInvitacion,
} from "../../../servidor/usuarios";
import type {
  ResultadoDeAccionDeInvitacion,
  ResultadoDeInvitar,
} from "../../../ui/plantillas/usuarios/resultado-de-usuarios";

// Las acciones de servidor de «Usuarios» (tramos U2 y U4), expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen
// vive en `servidor/usuarios.ts`. Reciben el estado anterior que pasa `useActionState`. El id de la invitación o de la persona de la ficha se liga con `.bind` al armar la página (Next lo cifra): nunca va
// en el formulario. La empresa y la persona que actúa no viajan: las decide el servidor. Ninguna redirige: dicen adónde ir y la pantalla navega, o se queda y vuelve a pedir la ficha.

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

/** U4: guardar las sucursales tildadas de un empleado (ninguna tildada es el conjunto vacío). */
export async function asignarSucursalesAccion(
  personaId: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return guardarLasSucursalesDeUnEmpleado(personaId, datos);
}
