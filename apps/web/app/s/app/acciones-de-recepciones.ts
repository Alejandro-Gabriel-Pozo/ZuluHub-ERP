"use server";

import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import {
  anularLaRecepcionDeLaPantalla,
  confirmarLaRecepcionDeLaPantalla,
  corregirLoRecibidoDelFormulario,
  registrarLaRecepcionDelFormulario,
} from "../../../servidor/recepciones";
import type {
  LoRecibidoCorregidoParaLaPantalla,
  RecepcionRegistradaParaLaPantalla,
} from "../../../servidor/recepciones";
import type { ResultadoDeLaRecepcion } from "../../../ui/plantillas/compras/recepciones/resultado-de-recepcion";

// Las acciones de servidor de «Recepciones» (Compras 4), expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen vive en
// `servidor/recepciones.ts`. «Recibir» lleva su clave de idempotencia en el pedido (la genera la pantalla por intento). Confirmar y anular reciben el estado anterior que pasa `useActionState`; la recepción la liga
// el formulario con `.bind` (Next la cifra): no viaja en un campo. La empresa, la persona y la sucursal no viajan: las decide el servidor. NO redirigen (un `redirect` dentro de una acción pierde el host): la pantalla navega.

export async function registrarRecepcionAccion(
  pedido: unknown,
): Promise<Respuesta<RecepcionRegistradaParaLaPantalla>> {
  return registrarLaRecepcionDelFormulario(pedido);
}

export async function confirmarRecepcionAccion(
  recepcionId: string,
  previo: ResultadoDeLaRecepcion,
  datos: FormData,
): Promise<ResultadoDeLaRecepcion> {
  void previo;
  return confirmarLaRecepcionDeLaPantalla(recepcionId, datos);
}

export async function anularRecepcionAccion(
  recepcionId: string,
  previo: ResultadoDeLaRecepcion,
  datos: FormData,
): Promise<ResultadoDeLaRecepcion> {
  void previo;
  return anularLaRecepcionDeLaPantalla(recepcionId, datos);
}

/** «Corregir lo recibido»: el pedido lleva su clave de idempotencia (la genera la pantalla por intento); la empresa, la persona y la sucursal no viajan. */
export async function corregirLoRecibidoAccion(
  pedido: unknown,
): Promise<Respuesta<LoRecibidoCorregidoParaLaPantalla>> {
  return corregirLoRecibidoDelFormulario(pedido);
}
