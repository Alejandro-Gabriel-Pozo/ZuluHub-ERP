"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import { elegirLaSucursal } from "../../../servidor/facturacion";

// La acción del servidor «elegir la sucursal del listado», expuesta a Next. Fina a propósito (ADR-015, punto 2): la directiva
// `"use server"` tiene que ser lo primero de este archivo, así que lo que hace vive en `servidor/facturacion.ts` (que empieza con
// `server-only`). Recibe el estado anterior que pasa `useActionState`; la sucursal viaja en el formulario y el servidor la valida.

export async function elegirSucursalAccion(
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return elegirLaSucursal(datos);
}
