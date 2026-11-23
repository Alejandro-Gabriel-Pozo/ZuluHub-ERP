"use server";

import {
  cancelarElCierreDeLaSucursal,
  cerrarElDiaDeLaSucursal,
  corregirElMedioDelCobro,
  darElConformeDeLaSucursal,
  declararElTotalDeLaSucursal,
  empezarElCierreDeLaSucursal,
} from "../../../servidor/cierre-del-dia";

// Las acciones de servidor de «Cierre del día», expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` va primero y lo que hacen vive en `servidor/cierre-del-dia.ts`.
// Reciben el pedido tal como lo arma la pantalla (sin tipo: se lee y se valida en el servidor) y devuelven la respuesta ya traducida (ADR-016). Del pedido solo valen la jornada, la clave y
// lo que se carga en los campos: la empresa, la sucursal y quién actúa no viajan, los decide el servidor.

export async function empezarElCierreAccion(entrada: unknown) {
  return empezarElCierreDeLaSucursal(entrada);
}

export async function cancelarElCierreAccion(entrada: unknown) {
  return cancelarElCierreDeLaSucursal(entrada);
}

export async function cerrarElDiaAccion(entrada: unknown) {
  return cerrarElDiaDeLaSucursal(entrada);
}

export async function corregirElMedioAccion(entrada: unknown) {
  return corregirElMedioDelCobro(entrada);
}

export async function declararElTotalAccion(entrada: unknown) {
  return declararElTotalDeLaSucursal(entrada);
}

export async function darElConformeAccion(entrada: unknown) {
  return darElConformeDeLaSucursal(entrada);
}
