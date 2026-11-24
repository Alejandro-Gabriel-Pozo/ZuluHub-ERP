"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import { guardarLasSucursalesDeUnEmpleado } from "../../../servidor/usuarios";

// Las acciones de servidor de «Usuarios» de Cuenta, expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen
// vive en `servidor/usuarios.ts`. Las de formulario reciben el estado anterior que pasa `useActionState`. La persona de la ficha se liga con `.bind` al armar la página (Next la cifra: no viaja en un
// campo). La empresa y quien actúa no viajan: las decide el servidor.

/** U4: guardar las sucursales tildadas de un empleado (ninguna tildada es el conjunto vacío). */
export async function asignarSucursalesAccion(
  personaId: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return guardarLasSucursalesDeUnEmpleado(personaId, datos);
}
