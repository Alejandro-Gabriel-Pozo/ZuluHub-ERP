"use server";

import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import {
  cerrarLaMesaACuentaDelSalon,
  elClienteParaVenderDelMostrador,
  venderLaVentaACuentaDelMostrador,
  type ClienteElegidoParaLaPantalla,
  type VentaACuentaParaLaPantalla,
} from "../../../servidor/vender-a-cuenta";

// Las acciones de servidor de «Vender a cuenta corriente», expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen vive en
// `servidor/vender-a-cuenta.ts`. Cargar a cuenta mueve stock y crea una deuda: la cuenta y el ejemplar los genera la pantalla por intento y los repite en cada reintento (repetir devuelve lo hecho, no lo duplica).
// La empresa, la persona y la sucursal no viajan en el pedido: las decide el servidor; el permiso lo exige cada caso de uso adentro.

/** El saldo y la previsión de UN cliente elegido (lectura con constancia). */
export async function verElClienteParaVenderAccion(
  pedido: unknown,
): Promise<Respuesta<ClienteElegidoParaLaPantalla>> {
  return elClienteParaVenderDelMostrador(pedido);
}

/** «Confirmar venta a cuenta» de la venta rápida. */
export async function venderLaVentaACuentaAccion(
  pedido: unknown,
): Promise<Respuesta<VentaACuentaParaLaPantalla>> {
  return venderLaVentaACuentaDelMostrador(pedido);
}

/** «Confirmar venta a cuenta» de la mesa del salón: la cuenta que ya existe. */
export async function cerrarLaMesaACuentaAccion(
  pedido: unknown,
): Promise<Respuesta<VentaACuentaParaLaPantalla>> {
  return cerrarLaMesaACuentaDelSalon(pedido);
}
