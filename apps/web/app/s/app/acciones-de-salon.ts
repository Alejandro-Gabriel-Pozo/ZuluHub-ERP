"use server";

import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { cambiarElOrdenDeSalida, quitarElPlatoSinEnviar } from "../../../servidor/comandas";
import {
  agregarAlPedidoDeLaMesaDelSalon,
  cambiarDeMesaLaCuentaDelSalon,
  liberarLaMesaDelSalon,
  tomarElPedidoDeLaMesa,
} from "../../../servidor/salon";

// Las acciones de servidor de la FICHA DE LA MESA del salón (SAL-B), expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo
// que hacen vive en `servidor/salon.ts` y `servidor/comandas.ts`. Cada una escribe: la empresa, la persona y la sucursal no viajan en el pedido (las decide el servidor, que también valida el permiso y que la mesa o
// la cuenta sea de esa sucursal); el precio de un plato sale del catálogo y nunca del navegador. Repetir no duplica: «Tomar pedido» lleva el id de la cuenta que fija la página, «Agregar» el id de la línea de
// cada intento, y quitar, liberar, cambiar de mesa y el orden de salida devuelven lo ya hecho.

export async function tomarPedidoAccion(pedido: unknown): Promise<Respuesta<unknown>> {
  return tomarElPedidoDeLaMesa(pedido);
}

export async function agregarAlPedidoAccion(pedido: unknown): Promise<Respuesta<unknown>> {
  return agregarAlPedidoDeLaMesaDelSalon(pedido);
}

export async function cambiarSalidaAccion(pedido: unknown): Promise<Respuesta<unknown>> {
  return cambiarElOrdenDeSalida(pedido);
}

export async function quitarSinEnviarAccion(pedido: unknown): Promise<Respuesta<unknown>> {
  return quitarElPlatoSinEnviar(pedido);
}

export async function liberarMesaAccion(pedido: unknown): Promise<Respuesta<unknown>> {
  return liberarLaMesaDelSalon(pedido);
}

export async function cambiarDeMesaAccion(pedido: unknown): Promise<Respuesta<unknown>> {
  return cambiarDeMesaLaCuentaDelSalon(pedido);
}
