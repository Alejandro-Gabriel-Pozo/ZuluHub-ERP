"use server";

import {
  anularElPagoDeLaFactura,
  declararElPagoDeLaFactura,
} from "../../../servidor/pago-de-factura";
import type {
  ResultadoDeAnularPago,
  ResultadoDeDeclararPago,
} from "../../../ui/plantillas/compras/pago/resultado-de-pago";

// Las acciones de servidor de «Declarar pago» y de anular un pago (Compras PR 8), expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que
// lo que hacen vive en `servidor/pago-de-factura.ts`. Reciben el estado anterior que pasa `useActionState`. La compra, la factura o el pago y la clave de este intento se ligan con `.bind` al armar la página
// (Next los cifra): no viajan en un campo del formulario. La empresa y la persona no viajan: las decide el servidor. Ninguna redirige: la pantalla navega.

export async function declararElPagoAccion(
  recepcionId: string,
  comprobanteId: string,
  clave: string,
  previo: ResultadoDeDeclararPago,
  datos: FormData,
): Promise<ResultadoDeDeclararPago> {
  void previo;
  return declararElPagoDeLaFactura(recepcionId, comprobanteId, clave, datos);
}

export async function anularElPagoAccion(
  recepcionId: string,
  pagoId: string,
  previo: ResultadoDeAnularPago,
  datos: FormData,
): Promise<ResultadoDeAnularPago> {
  void previo;
  return anularElPagoDeLaFactura(recepcionId, pagoId, datos);
}
