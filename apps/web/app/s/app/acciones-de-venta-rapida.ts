"use server";

import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { cotizarElCarritoDeLaSucursal, type CarritoCotizado } from "../../../servidor/venta-rapida";

// La acción de servidor de la VENTA RÁPIDA, expuesta a Next. Fina a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hace vive en
// `servidor/venta-rapida.ts`. Cotizar es una LECTURA: no escribe ni audita, así que repetirla (clic doble, reintento, red caída) no puede duplicar nada. La empresa, la persona y la sucursal no
// viajan en el pedido: las decide el servidor; del navegador solo se leen las líneas elegidas, y el precio y el total vuelven del servidor.

export async function cotizarElCarritoAccion(pedido: unknown): Promise<Respuesta<CarritoCotizado>> {
  return cotizarElCarritoDeLaSucursal(pedido);
}
