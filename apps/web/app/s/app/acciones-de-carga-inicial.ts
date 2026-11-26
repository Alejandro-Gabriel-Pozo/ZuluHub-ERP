"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import { registrarLaCargaInicialDeLaSucursal } from "../../../servidor/carga-inicial-de-stock";

// La acción de servidor de la carga inicial de stock, expuesta a Next. Fina a propósito (ADR-015, punto 2): `"use server"` va primero, lo que hace vive en `servidor/carga-inicial-de-stock.ts`. La clave de
// idempotencia se liga con `.bind` al armar la página: no viaja en un campo. La empresa, la persona y la sucursal no viajan: las decide el servidor.

export async function registrarCargaInicialAccion(
  clave: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return registrarLaCargaInicialDeLaSucursal(clave, datos);
}
