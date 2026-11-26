"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  abrirElConteoDeLaSucursal,
  aplicarElConteoDeLaSucursal,
  cancelarElConteoDeLaSucursal,
  guardarLoContadoDeLaSucursal,
} from "../../../servidor/conteo-de-stock";

// Las acciones de servidor del conteo físico de stock, expuestas a Next. Finas a propósito (ADR-015, punto 2): `"use server"` va primero, lo que hacen vive en `servidor/conteo-de-stock.ts`. El id del conteo, el depósito y la
// huella de lo que se vio se ligan con `.bind` al armar la página: no viajan en un campo que la persona edite. La empresa, la persona y la sucursal no viajan: las decide el servidor.

export async function abrirConteoAccion(
  id: string,
  depositoId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return abrirElConteoDeLaSucursal(id, depositoId);
}

export async function guardarLoContadoAccion(
  conteoId: string,
  entrada: Readonly<{ id: string; articuloId: string; cantidad: string; hora: string }>,
): Promise<ResultadoDeAccion> {
  return guardarLoContadoDeLaSucursal(conteoId, entrada);
}

export async function cancelarConteoAccion(
  conteoId: string,
  depositoId: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return cancelarElConteoDeLaSucursal(conteoId, depositoId, datos);
}

export async function aplicarConteoAccion(
  conteoId: string,
  huella: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return aplicarElConteoDeLaSucursal(conteoId, huella, datos);
}
