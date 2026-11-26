"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  cambiarLasCondicionesDeLaCuentaDelCliente,
  habilitarLaCuentaDelCliente,
  reactivarLaCuentaDelCliente,
  suspenderLaCuentaDelCliente,
} from "../../../servidor/cuenta-corriente-escritura";

// Las acciones de servidor de la cuenta corriente de clientes (A2), expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así
// que lo que hacen vive en `servidor/cuenta-corriente-escritura.ts`. Reciben el estado anterior que pasa `useActionState`. El identificador del alta, el cliente, la ficha y la versión que se vio
// se ligan con `.bind` desde la página; la empresa y la persona no viajan: las decide el servidor.

export async function habilitarCuentaAccion(
  id: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return habilitarLaCuentaDelCliente(id, datos);
}

export async function cambiarCondicionesAccion(
  parteId: string,
  cuentaId: string,
  versionEsperada: number,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return cambiarLasCondicionesDeLaCuentaDelCliente(parteId, cuentaId, versionEsperada, datos);
}

export async function suspenderCuentaAccion(
  parteId: string,
  cuentaId: string,
  versionEsperada: number,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return suspenderLaCuentaDelCliente(parteId, cuentaId, versionEsperada, datos);
}

export async function reactivarCuentaAccion(
  parteId: string,
  cuentaId: string,
  versionEsperada: number,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return reactivarLaCuentaDelCliente(parteId, cuentaId, versionEsperada, datos);
}
