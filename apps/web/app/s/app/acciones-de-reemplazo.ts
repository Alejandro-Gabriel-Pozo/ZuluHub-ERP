"use server";

import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import {
  cambiarElComprobanteDelFormulario,
  reemplazarLaFacturaDelFormulario,
  type ComprobanteReemplazadoParaLaPantalla,
} from "../../../servidor/reemplazo";

// Las acciones de servidor de «Reemplazar el comprobante» (NOTAS-2c-2), expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen vive en
// `servidor/reemplazo.ts`. Cada una lleva su clave de idempotencia en el pedido (la genera la pantalla por intento). La empresa, la persona y el proveedor de la factura nueva no viajan: los decide el servidor. NO redirigen.

export async function reemplazarFacturaAccion(
  pedido: unknown,
): Promise<Respuesta<ComprobanteReemplazadoParaLaPantalla>> {
  return reemplazarLaFacturaDelFormulario(pedido);
}

export async function cambiarElComprobanteAccion(
  pedido: unknown,
): Promise<Respuesta<ComprobanteReemplazadoParaLaPantalla>> {
  return cambiarElComprobanteDelFormulario(pedido);
}
