"use server";

import {
  agregarComprobanteDeLaFicha,
  agregarPuntoDeVentaDeLaFicha,
  dejarDeUsarComprobanteDeLaFicha,
  dejarDeUsarPuntoDeVentaDeLaFicha,
  pedirComprobanteDeLaFicha,
  pedirPuntoDeVentaDeLaFicha,
  resolverPedidoDeLaFicha,
} from "../../../servidor/ficha-de-proveedor";
import type { ResultadoDeFichaDeProveedor } from "../../../ui/plantillas/compras/proveedor/resultado-de-proveedor";

// Las acciones de servidor de la ficha del proveedor de compras (Compras PR 4), expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así
// que lo que hacen vive en `servidor/ficha-de-proveedor.ts`. Reciben el estado anterior que pasa `useActionState`. El proveedor, el pedido, la decisión, el número y el tipo que no se escriben se ligan con
// `.bind` al armar la página (Next los cifra): nunca viajan en el formulario. La empresa y la persona no viajan: las decide el servidor. Ninguna redirige: la pantalla vuelve a cargar.

export async function agregarPuntoDeVentaAccion(
  parteId: string,
  previo: ResultadoDeFichaDeProveedor,
  datos: FormData,
): Promise<ResultadoDeFichaDeProveedor> {
  void previo;
  return agregarPuntoDeVentaDeLaFicha(parteId, datos);
}

export async function pedirPuntoDeVentaAccion(
  parteId: string,
  previo: ResultadoDeFichaDeProveedor,
  datos: FormData,
): Promise<ResultadoDeFichaDeProveedor> {
  void previo;
  return pedirPuntoDeVentaDeLaFicha(parteId, datos);
}

export async function dejarDeUsarPuntoDeVentaAccion(
  parteId: string,
  numero: number,
  previo: ResultadoDeFichaDeProveedor,
  datos: FormData,
): Promise<ResultadoDeFichaDeProveedor> {
  void previo;
  void datos;
  return dejarDeUsarPuntoDeVentaDeLaFicha(parteId, numero);
}

export async function agregarComprobanteAccion(
  parteId: string,
  previo: ResultadoDeFichaDeProveedor,
  datos: FormData,
): Promise<ResultadoDeFichaDeProveedor> {
  void previo;
  return agregarComprobanteDeLaFicha(parteId, datos);
}

export async function pedirComprobanteAccion(
  parteId: string,
  previo: ResultadoDeFichaDeProveedor,
  datos: FormData,
): Promise<ResultadoDeFichaDeProveedor> {
  void previo;
  return pedirComprobanteDeLaFicha(parteId, datos);
}

export async function dejarDeUsarComprobanteAccion(
  parteId: string,
  tipo: string,
  previo: ResultadoDeFichaDeProveedor,
  datos: FormData,
): Promise<ResultadoDeFichaDeProveedor> {
  void previo;
  void datos;
  return dejarDeUsarComprobanteDeLaFicha(parteId, tipo);
}

export async function resolverPedidoAccion(
  pedidoId: string,
  decision: "APROBAR" | "RECHAZAR",
  previo: ResultadoDeFichaDeProveedor,
  datos: FormData,
): Promise<ResultadoDeFichaDeProveedor> {
  void previo;
  void datos;
  return resolverPedidoDeLaFicha(pedidoId, decision);
}
