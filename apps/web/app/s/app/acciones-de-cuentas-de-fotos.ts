"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import { declararLaCuenta, retirarLaCuenta } from "../../../servidor/cuentas-de-fotos";

// Las acciones de servidor de «Conectá tu cuenta de fotos», expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen
// vive en `servidor/cuentas-de-fotos.ts`. Reciben el estado anterior que pasa `useActionState`. La clave del gesto, la cuenta y su versión se ligan con `.bind` al armar la página: Next los cifra, no
// viajan en un campo. La empresa y la persona no viajan: las decide el servidor.

/** Declarar: la clave del gesto que ligó la página y la cuenta del formulario. */
export async function declararLaCuentaAccion(
  ligado: Readonly<{ claveDeIdempotencia: string }>,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return declararLaCuenta(ligado, datos);
}

/** Retirar: la cuenta y la versión que ligó la página, y el motivo del formulario. */
export async function retirarLaCuentaAccion(
  ligado: Readonly<{ id: string; versionEsperada: number }>,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return retirarLaCuenta(ligado, datos);
}
