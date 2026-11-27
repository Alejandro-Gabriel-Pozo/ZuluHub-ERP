"use server";

import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import {
  anularLaNotaDeLaPantalla,
  registrarLaNotaDelFormulario,
  type NotaRegistradaParaLaPantalla,
} from "../../../servidor/notas";
import type { ResultadoDeAnularPago } from "../../../ui/plantillas/compras/pago/resultado-de-pago";

// Las acciones de servidor de las notas del proveedor (NOTAS-2c-1), expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen vive en
// `servidor/notas.ts`. Cada clase (crédito o débito) es su propia acción: la clase no viaja en el pedido. «Guardar» lleva su clave de idempotencia en el pedido (la genera la pantalla por intento). Anular recibe el estado
// anterior que pasa `useActionState`; la factura, la nota y su clase las liga la página con `.bind` (Next las cifra): no viajan en un campo. La empresa y la persona no viajan: las decide el servidor. NO redirigen.

export async function registrarNotaDeCreditoAccion(
  pedido: unknown,
): Promise<Respuesta<NotaRegistradaParaLaPantalla>> {
  return registrarLaNotaDelFormulario("CREDITO", pedido);
}

export async function registrarNotaDeDebitoAccion(
  pedido: unknown,
): Promise<Respuesta<NotaRegistradaParaLaPantalla>> {
  return registrarLaNotaDelFormulario("DEBITO", pedido);
}

export async function anularNotaDeCreditoAccion(
  facturaId: string,
  notaId: string,
  previo: ResultadoDeAnularPago,
  datos: FormData,
): Promise<ResultadoDeAnularPago> {
  void previo;
  return anularLaNotaDeLaPantalla(facturaId, notaId, "CREDITO", datos);
}

export async function anularNotaDeDebitoAccion(
  facturaId: string,
  notaId: string,
  previo: ResultadoDeAnularPago,
  datos: FormData,
): Promise<ResultadoDeAnularPago> {
  void previo;
  return anularLaNotaDeLaPantalla(facturaId, notaId, "DEBITO", datos);
}
