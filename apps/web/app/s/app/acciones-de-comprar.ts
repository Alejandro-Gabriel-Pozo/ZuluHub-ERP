"use server";

import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import {
  agregarUnProveedorParaComprar,
  buscarProductosParaComprar,
  buscarProveedoresParaComprar,
  cotizarLaCompraDelFormulario,
  registrarLaCompraDelFormulario,
} from "../../../servidor/comprar";
import type {
  CompraCotizadaParaLaPantalla,
  CompraRegistradaParaLaPantalla,
  ProductosParaComprarEnLaPantalla,
  ProveedorParaElegir,
  ResultadoDeGuardar,
} from "../../../servidor/comprar";

// Las acciones de servidor de «Nueva compra», expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen vive en
// `servidor/comprar.ts`. Buscar y cotizar son LECTURAS (no escriben ni auditan: repetirlas da lo mismo). Registrar y agregar proveedor escriben y llevan su clave de idempotencia en el pedido (la genera la
// pantalla por intento). La empresa, la persona y la sucursal no viajan: las decide el servidor. NO redirigen (un `redirect` dentro de una acción pierde el host): la pantalla navega.

export async function buscarProductosAccion(
  texto: string,
): Promise<Respuesta<ProductosParaComprarEnLaPantalla>> {
  return buscarProductosParaComprar(texto);
}

export async function cotizarCompraAccion(
  renglones: unknown,
): Promise<Respuesta<CompraCotizadaParaLaPantalla>> {
  return cotizarLaCompraDelFormulario(renglones);
}

export async function registrarCompraAccion(
  pedido: unknown,
): Promise<Respuesta<CompraRegistradaParaLaPantalla>> {
  return registrarLaCompraDelFormulario(pedido);
}

export async function buscarProveedoresAccion(
  texto: string,
): Promise<Respuesta<readonly ProveedorParaElegir[]>> {
  return buscarProveedoresParaComprar(texto);
}

export async function agregarProveedorAccion(
  clave: string,
  naturaleza: string,
  nombre: string,
  guardarIgual: boolean,
): Promise<Respuesta<ResultadoDeGuardar>> {
  return agregarUnProveedorParaComprar(clave, naturaleza, nombre, guardarIgual);
}
