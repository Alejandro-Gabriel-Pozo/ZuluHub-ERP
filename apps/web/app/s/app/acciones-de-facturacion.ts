"use server";

import {
  cambiarElAmbiente,
  descartarElComprobante,
  emitirLaFactura,
  emitirLaNotaDeCredito,
  emitirLaNotaDeDebito,
  listarLosComprobantes,
  reintentarElComprobante,
  resincronizarLaSerie,
  verElComprobante,
} from "../../../servidor/facturacion";

// Las acciones de servidor del facturador, expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva
// `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen vive en `servidor/facturacion.ts`
// (que empieza con `server-only`). Reciben el pedido tal como lo arma la pantalla (sin tipo: se lee y se valida en el
// servidor) y devuelven la respuesta ya traducida (ADR-016). Se llaman con el contenido del comprobante: la empresa, el
// emisor y quién actúa no viajan, los decide el servidor.

export async function emitirFacturaAccion(entrada: unknown) {
  return emitirLaFactura(entrada);
}

export async function emitirNotaDeCreditoAccion(entrada: unknown) {
  return emitirLaNotaDeCredito(entrada);
}

export async function emitirNotaDeDebitoAccion(entrada: unknown) {
  return emitirLaNotaDeDebito(entrada);
}

export async function descartarComprobanteAccion(entrada: unknown) {
  return descartarElComprobante(entrada);
}

export async function reintentarComprobanteAccion(entrada: unknown) {
  return reintentarElComprobante(entrada);
}

export async function resincronizarSerieAccion(entrada: unknown) {
  return resincronizarLaSerie(entrada);
}

export async function cambiarAmbienteAccion(entrada: unknown) {
  return cambiarElAmbiente(entrada);
}

export async function listarComprobantesAccion(entrada?: unknown) {
  return listarLosComprobantes(entrada);
}

export async function verComprobanteAccion(entrada: unknown) {
  return verElComprobante(entrada);
}
