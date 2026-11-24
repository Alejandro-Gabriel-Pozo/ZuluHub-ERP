"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import { desactivarElUsuario } from "../../../servidor/usuarios";

// Las acciones de servidor de «Usuarios» de Cuenta, expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen
// vive en `servidor/usuarios.ts`. Las de formulario reciben el estado anterior que pasa `useActionState`. El id de la persona se liga con `.bind` al armar la página: Next lo cifra, no viaja en un campo.
// La empresa y quien pide no viajan: las decide el servidor.

/** Desactivar: el id de la persona de la ficha lo liga la página con `.bind`. Repetirla no duplica (la segunda no escribe). */
export async function desactivarUsuarioAccion(
  personaId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return desactivarElUsuario(personaId);
}
