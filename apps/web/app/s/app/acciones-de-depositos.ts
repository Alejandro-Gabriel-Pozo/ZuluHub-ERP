"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import { agregarElDepositoDeLaSucursal } from "../../../servidor/depositos-de-stock";

// La acción de servidor de «Depósitos» de stock, expuesta a Next. Fina a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo
// que hace vive en `servidor/depositos-de-stock.ts`. Recibe el estado anterior que pasa `useActionState`. El identificador del alta se liga con `.bind` al armar la página. La empresa, la
// persona y la sucursal no viajan: las decide el servidor.

export async function agregarDepositoAccion(
  id: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return agregarElDepositoDeLaSucursal(id, datos);
}
