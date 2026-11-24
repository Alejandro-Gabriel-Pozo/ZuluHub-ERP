"use server";

import {
  anularLaCompraDeLaPantalla,
  corregirLaLineaDeLaCompra,
} from "../../../servidor/correccion-de-compra";
import type {
  ResultadoDeAnular,
  ResultadoDeCorregir,
} from "../../../ui/plantillas/compras/correccion/resultado-de-correccion";

// Las acciones de servidor de «Corregir» y «Anular» una compra (Compras PR 10), expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así
// que lo que hacen vive en `servidor/correccion-de-compra.ts`. Reciben el estado anterior que pasa `useActionState`. La compra, la línea, las correcciones que se vieron y la clave de este intento se ligan con
// `.bind` al armar la página (Next los cifra): no viajan en un campo del formulario. La empresa y la persona no viajan: las decide el servidor. Ninguna redirige: la pantalla navega.

export async function corregirLaLineaAccion(
  recepcionId: string,
  linea: number,
  correccionesVistas: number,
  clave: string,
  previo: ResultadoDeCorregir,
  datos: FormData,
): Promise<ResultadoDeCorregir> {
  void previo;
  return corregirLaLineaDeLaCompra(recepcionId, linea, correccionesVistas, clave, datos);
}

export async function anularCompraAccion(
  recepcionId: string,
  previo: ResultadoDeAnular,
  datos: FormData,
): Promise<ResultadoDeAnular> {
  void previo;
  return anularLaCompraDeLaPantalla(recepcionId, datos);
}
