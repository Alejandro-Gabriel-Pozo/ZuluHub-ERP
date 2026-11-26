"use server";

import { redirect } from "next/navigation";
import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  archivarUnRol,
  asignarUnRol,
  crearUnRol,
  guardarUnRol,
  reactivarUnRol,
} from "../../../servidor/roles";
import { rutaDeLaFichaDeRol } from "../../../ui/plantillas/sesion/rutas-de-cuenta";

// Las acciones de servidor de «Roles», expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen vive en `servidor/roles.ts`.
// Reciben el estado anterior que pasa `useActionState`. El id del rol (y la versión que se vio) se liga con `.bind` al armar la página (Next lo cifra): nunca va en el formulario. La empresa y la persona que actúa no viajan.

/** Crear un rol: el id lo genera la página al abrir el formulario (clave de idempotencia). Si sale bien va a la ficha del rol, para elegir sus acciones. */
export async function crearRolAccion(
  rolId: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  const resultado = await crearUnRol(rolId, datos);
  if (resultado.rolId !== null) redirect(rutaDeLaFichaDeRol(resultado.rolId));
  return { error: resultado.error };
}

/** Guardar la ficha de un rol (nombre y, si cambió, sus acciones). El rol y la versión que se vio los liga la página con `.bind`. */
export async function guardarRolAccion(
  rolId: string,
  versionEsperada: number,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return guardarUnRol(rolId, versionEsperada, datos);
}

/** Archivar el rol de la ficha (id ligado con `.bind`). Repetirlo no duplica. */
export async function archivarRolAccion(
  rolId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return archivarUnRol(rolId);
}

/** Reactivar el rol archivado de la ficha (id ligado con `.bind`). Repetirlo no duplica. */
export async function reactivarRolAccion(
  rolId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return reactivarUnRol(rolId);
}

/** Asignar el rol elegido a la persona de la ficha (id ligado con `.bind`; del formulario solo viaja el rol). Repetirlo no duplica. */
export async function asignarRolAccion(
  personaId: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return asignarUnRol(personaId, datos);
}
