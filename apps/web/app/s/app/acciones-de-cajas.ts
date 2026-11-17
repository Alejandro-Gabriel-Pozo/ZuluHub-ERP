"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  agregarLaCajaDeLaSucursal,
  desactivarLaCajaDeLaSucursal,
  editarLaCajaDeLaSucursal,
  reactivarLaCajaDeLaSucursal,
} from "../../../servidor/cajas";

// Las acciones de servidor de «Cajas», expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que
// hacen vive en `servidor/cajas.ts`. Las de formulario reciben el estado anterior que pasa `useActionState`. El id (y la versión) de la caja se ligan con `.bind` al armar la página.
// La empresa, la persona y la sucursal no viajan: las decide el servidor.

export async function agregarCajaAccion(
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return agregarLaCajaDeLaSucursal(datos);
}

export async function editarCajaAccion(
  cajaId: string,
  versionEsperada: number,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return editarLaCajaDeLaSucursal(cajaId, versionEsperada, datos);
}

export async function desactivarCajaAccion(
  cajaId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return desactivarLaCajaDeLaSucursal(cajaId);
}

export async function reactivarCajaAccion(
  cajaId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return reactivarLaCajaDeLaSucursal(cajaId);
}
