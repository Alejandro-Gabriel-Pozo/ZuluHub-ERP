"use server";

import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import {
  anularElItemEnviado,
  cambiarElOrdenDeSalida,
  cargarElPapelDelDocumento,
  declararSiSeImprimio,
  enviarLaCuentaALaCocina,
  imprimirElDocumento,
  pedirQueSalgaLoQueEspera,
  quitarElPlatoSinEnviar,
  reimprimirElDocumento,
} from "../../../servidor/comandas";
import {
  agregarAlPedidoDeLaMesaDelSalon,
  cambiarDeMesaLaCuentaDelSalon,
  unirLasMesasDelSalon,
  liberarLaMesaDelSalon,
  tomarElPedidoDeLaMesa,
} from "../../../servidor/salon";

// Las acciones de servidor de la FICHA DE LA MESA del salón (SAL-B), expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo
// que hacen vive en `servidor/salon.ts` y `servidor/comandas.ts`. Cada una escribe: la empresa, la persona y la sucursal no viajan en el pedido (las decide el servidor, que también valida el permiso y que la mesa o
// la cuenta sea de esa sucursal); el precio de un plato sale del catálogo y nunca del navegador. Repetir no duplica: «Tomar pedido» lleva el id de la cuenta que fija la página, «Agregar» el id de la línea de
// cada intento, enviar a cocina el id y la clave del envío, anular un ítem enviado el id del aviso, imprimir el id del trabajo, y quitar, liberar, cambiar de mesa, el orden de salida y declarar el resultado de una
// impresión devuelven lo ya hecho. Imprimir nunca bloquea el envío: sin impresora el envío queda registrado igual.

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

export async function unirMesasAccion(pedido: unknown): Promise<Respuesta<unknown>> {
  return unirLasMesasDelSalon(pedido);
}

export async function enviarACocinaAccion(pedido: unknown) {
  return enviarLaCuentaALaCocina(pedido);
}

export async function pedirQueSalgaAccion(pedido: unknown) {
  return pedirQueSalgaLoQueEspera(pedido);
}

export async function anularItemEnviadoAccion(pedido: unknown) {
  return anularElItemEnviado(pedido);
}

export async function imprimirDocumentoAccion(pedido: unknown) {
  return imprimirElDocumento(pedido);
}

export async function reimprimirDocumentoAccion(pedido: unknown) {
  return reimprimirElDocumento(pedido);
}

export async function declararImpresionAccion(pedido: unknown) {
  return declararSiSeImprimio(pedido);
}

/** El papel de un documento para que el navegador lo imprima: es una lectura (`comandas.ver`), repetirla no cambia nada. */
export async function papelDelDocumentoAccion(pedido: unknown) {
  return cargarElPapelDelDocumento(pedido);
}
