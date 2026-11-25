"use server";

import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import {
  anularLaConciliacionDeLaPantalla,
  conciliarLaFacturaDelFormulario,
  registrarLaFacturaDelFormulario,
} from "../../../servidor/facturas";
import type {
  FacturaConciliadaParaLaPantalla,
  FacturaRegistradaParaLaPantalla,
} from "../../../servidor/facturas";
import type { ResultadoDeLaFactura } from "../../../ui/plantillas/compras/facturas/resultado-de-factura";

// Las acciones de servidor de «Facturas» (Compras 4), expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen vive en
// `servidor/facturas.ts`. «Cargar factura» y «Confirmar conciliación» llevan su clave de idempotencia en el pedido (la genera la pantalla por intento). Anular una conciliación recibe el estado anterior que pasa
// `useActionState`; la factura y la conciliación las liga la página con `.bind` (Next las cifra): no viajan en un campo. La empresa y la persona no viajan: las decide el servidor. NO redirigen (un `redirect`
// dentro de una acción pierde el host): la pantalla navega.

export async function registrarFacturaAccion(
  pedido: unknown,
): Promise<Respuesta<FacturaRegistradaParaLaPantalla>> {
  return registrarLaFacturaDelFormulario(pedido);
}

export async function conciliarFacturaAccion(
  pedido: unknown,
): Promise<Respuesta<FacturaConciliadaParaLaPantalla>> {
  return conciliarLaFacturaDelFormulario(pedido);
}

export async function anularConciliacionAccion(
  comprobanteId: string,
  conciliacionId: string,
  previo: ResultadoDeLaFactura,
  datos: FormData,
): Promise<ResultadoDeLaFactura> {
  void previo;
  void datos;
  return anularLaConciliacionDeLaPantalla(comprobanteId, conciliacionId);
}
