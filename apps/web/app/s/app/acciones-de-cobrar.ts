"use server";

import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import {
  anularElTicketDelMostrador,
  cobrarLaMesaDelSalon,
  cobrarLaVentaDelMostrador,
  papelDelTicketDelMostrador,
  type PapelDelTicketParaLaPantalla,
  type TicketAnuladoParaLaPantalla,
  type VentaCobradaParaLaPantalla,
} from "../../../servidor/cobrar";

// Las acciones de servidor de COBRAR y de ANULAR el ticket recién cobrado, expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este
// archivo, así que lo que hacen vive en `servidor/cobrar.ts`. Cobrar y anular escriben dinero y stock: la clave de idempotencia y los ids de la venta los genera la pantalla por intento y los repite
// en cada reintento (repetir devuelve lo hecho, no lo duplica). La empresa, la persona y la sucursal no viajan en el pedido: las decide el servidor; el permiso lo exige cada caso de uso adentro.

export async function cobrarLaVentaAccion(
  pedido: unknown,
): Promise<Respuesta<VentaCobradaParaLaPantalla>> {
  return cobrarLaVentaDelMostrador(pedido);
}

/** «Cobrar» la mesa del salón: la cuenta existente, en un acto (SAL-D). La clave y los ids de la cuenta y del ejemplar los fija la pantalla por intento. */
export async function cobrarLaMesaAccion(
  pedido: unknown,
): Promise<Respuesta<VentaCobradaParaLaPantalla>> {
  return cobrarLaMesaDelSalon(pedido);
}

export async function anularElTicketAccion(
  pedido: unknown,
): Promise<Respuesta<TicketAnuladoParaLaPantalla>> {
  return anularElTicketDelMostrador(pedido);
}

/** El papel del ticket cobrado para «Imprimir ticket»: es una lectura (`ventas.ver`), repetirla no cambia nada. */
export async function papelDelTicketAccion(
  pedido: unknown,
): Promise<Respuesta<PapelDelTicketParaLaPantalla>> {
  return papelDelTicketDelMostrador(pedido);
}
