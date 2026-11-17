"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  agregarLaCuenta,
  desactivarLaCuenta,
  editarLaCuenta,
  reactivarLaCuenta,
} from "../../../servidor/cuentas-de-cobro";

// Las acciones de servidor de «Cuentas de cobro», expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así
// que lo que hacen vive en `servidor/cuentas-de-cobro.ts`. Las de formulario reciben el estado anterior que pasa `useActionState`. El id (y la versión) de la cuenta se ligan con
// `.bind` al armar la página: Next los cifra, no viajan en un campo. La empresa y la persona no viajan: las decide el servidor.

export async function agregarCuentaAccion(
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return agregarLaCuenta(datos);
}

export async function editarCuentaAccion(
  cuentaDeCobroId: string,
  versionEsperada: number,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return editarLaCuenta(cuentaDeCobroId, versionEsperada, datos);
}

export async function desactivarCuentaAccion(
  cuentaDeCobroId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return desactivarLaCuenta(cuentaDeCobroId);
}

export async function reactivarCuentaAccion(
  cuentaDeCobroId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return reactivarLaCuenta(cuentaDeCobroId);
}
