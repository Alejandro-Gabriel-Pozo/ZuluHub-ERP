"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  agregarElDepositoDeLaSucursal,
  cambiarElEstadoDelDepositoDeLaSucursal,
  guardarElDeposito,
} from "../../../servidor/depositos-de-stock";

// La acción de servidor de «Depósitos» de stock, expuesta a Next. Fina a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo
// que hace vive en `servidor/depositos-de-stock.ts`. Recibe el estado anterior que pasa `useActionState`. El identificador del alta, el depósito, su versión y el sentido de desactivar o reactivar se ligan con `.bind` al armar la página: no viajan en un campo. La empresa, la
// persona y la sucursal no viajan: las decide el servidor.

export async function agregarDepositoAccion(
  id: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return agregarElDepositoDeLaSucursal(id, datos);
}

export async function editarDepositoAccion(
  depositoId: string,
  versionEsperada: number,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return guardarElDeposito(depositoId, versionEsperada, datos);
}

/** «Desactivar» (`activo: false`) y «Reactivar» (`activo: true`): sin campos; el depósito y el sentido los fija la página. */
export async function cambiarElEstadoDelDepositoAccion(
  depositoId: string,
  activo: boolean,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return cambiarElEstadoDelDepositoDeLaSucursal(depositoId, activo);
}
