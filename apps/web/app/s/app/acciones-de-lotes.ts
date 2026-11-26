"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  controlarElLoteDelArticuloDeLaPagina,
  corregirElLoteDeLaPagina,
  dejarDeControlarElLoteDelArticuloDeLaPagina,
  reasignarElLoteDeLaPagina,
} from "../../../servidor/lotes-escritura-de-stock";

// Las acciones de servidor de la pestaña «Lotes», expuestas a Next. Finas a propósito (ADR-015, punto 2): `"use server"` va primero, lo que hacen vive en `servidor/lotes-escritura-de-stock.ts`. El artículo, el lote, su
// versión y la clave de la reasignación se ligan con `.bind` al armar la página. La empresa, la persona y la sucursal no viajan: las decide el servidor.

export async function controlarLoteAccion(
  articuloId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return controlarElLoteDelArticuloDeLaPagina(articuloId);
}

export async function dejarDeControlarLoteAccion(
  articuloId: string,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return dejarDeControlarElLoteDelArticuloDeLaPagina(articuloId);
}

export async function corregirLoteAccion(
  articuloId: string,
  loteId: string,
  version: number,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return corregirElLoteDeLaPagina(articuloId, loteId, version, datos);
}

export async function reasignarLoteAccion(
  clave: string,
  articuloId: string,
  loteOrigenId: string,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return reasignarElLoteDeLaPagina(clave, articuloId, loteOrigenId, datos);
}
