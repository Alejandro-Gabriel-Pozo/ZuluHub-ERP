"use server";

import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { cobrarElTicketACuenta, leerElTicketACobrar } from "../../../servidor/cobrar-a-cuenta";
import type {
  TicketACobrarParaLaPantalla,
  TicketCobradoACuentaParaLaPantalla,
} from "../../../../../src/composicion/cobrar-a-cuenta-web";

// Las acciones de servidor de «Cobrar un ticket a cuenta» (CC-5 B2a), expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo
// que hacen vive en `servidor/cobrar-a-cuenta.ts`. El cobro escribe dinero: la clave de idempotencia y el ejemplar los genera la pantalla al abrir la hoja y los repite en cada reintento. La empresa y la persona
// no viajan en el pedido: las decide el servidor; el permiso lo exige cada caso adentro.

export async function leerElTicketACobrarAccion(
  pedido: unknown,
): Promise<Respuesta<TicketACobrarParaLaPantalla | null>> {
  return leerElTicketACobrar(pedido);
}

export async function cobrarElTicketACuentaAccion(
  pedido: unknown,
): Promise<Respuesta<TicketCobradoACuentaParaLaPantalla>> {
  return cobrarElTicketACuenta(pedido);
}
