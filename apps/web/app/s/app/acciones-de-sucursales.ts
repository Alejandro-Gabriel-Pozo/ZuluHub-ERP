"use server";

import { redirect } from "next/navigation";
import type { ResultadoDeAccion } from "../../../servidor/acciones";
import { crearUnaSucursalNueva } from "../../../servidor/sucursales";
import { RUTAS_DE_CUENTA } from "../../../ui/plantillas/sesion/rutas-de-cuenta";

// La acción de servidor de «Sucursales», expuesta a Next. Fina a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hace vive en `servidor/sucursales.ts`.
// Recibe el estado anterior que pasa `useActionState`. La empresa y la persona que actúa no viajan; del formulario solo se toma el nombre.

/** Crear una sucursal. Si sale bien (o ya existía una con ese nombre: un doble toque) vuelve a la lista; si no, devuelve el error ya traducido. */
export async function crearSucursalAccion(
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  const resultado = await crearUnaSucursalNueva(datos);
  if (resultado.creada) redirect(RUTAS_DE_CUENTA.sucursales);
  return { error: resultado.error };
}
