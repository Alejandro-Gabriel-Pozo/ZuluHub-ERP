"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  ajustarElStockDeLaSucursal,
  anularElMovimientoDeLaSucursal,
  registrarEntradaOSalidaDeStock,
  transferirElStockDeLaSucursal,
} from "../../../servidor/movimientos-de-stock";

// Las acciones de servidor de los movimientos de stock, expuestas a Next. Finas a propósito (ADR-015, punto 2): `"use server"` va primero, lo que hacen vive en `servidor/movimientos-de-stock.ts`. La clave de
// idempotencia (y, al anular, el movimiento) se ligan con `.bind` al armar la página: no viajan en un campo. La empresa, la persona y la sucursal no viajan: las decide el servidor.

export async function registrarEntradaAccion(
  clave: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return registrarEntradaOSalidaDeStock(clave, true, datos);
}

export async function registrarSalidaAccion(
  clave: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return registrarEntradaOSalidaDeStock(clave, false, datos);
}

export async function transferirAccion(
  clave: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return transferirElStockDeLaSucursal(clave, datos);
}

export async function ajustarAccion(
  clave: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return ajustarElStockDeLaSucursal(clave, datos);
}

export async function anularAccion(
  clave: string,
  movimientoId: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return anularElMovimientoDeLaSucursal(clave, movimientoId, datos);
}
