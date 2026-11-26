"use server";

import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import {
  cobrarElTicketACuenta,
  type TicketCobradoACuentaParaLaPantalla,
} from "../../../servidor/cobrar-a-cuenta";

// La acción de servidor de «Cobrar un ticket a cuenta» (CC-5 B2b), expuesta a Next. Fina a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo
// que hace vive en `servidor/cobrar-a-cuenta.ts`. Cobrar escribe dinero: la clave de idempotencia y el ejemplar que se vio los genera la pantalla por intento y los repite en cada reintento (repetir
// devuelve lo hecho, no lo duplica). La empresa y la persona no viajan en el pedido y el importe tampoco: el servidor pone el total del ticket; el permiso lo exige el caso de uso adentro.

export async function cobrarElTicketACuentaAccion(
  pedido: unknown,
): Promise<Respuesta<TicketCobradoACuentaParaLaPantalla>> {
  return cobrarElTicketACuenta(pedido);
}
