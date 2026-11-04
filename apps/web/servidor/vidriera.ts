import "server-only";

import { resolverProductoPorSegmento } from "../../../src/capacidades/experiencia/vidriera/direccion";
import {
  textosDeVidriera,
  type TextosDeVidriera,
} from "../../../src/capacidades/experiencia/vidriera/textos";
import {
  armarVistaDeVidriera,
  type VistaDeVidriera,
  type VistaDeProducto,
} from "../../../src/capacidades/experiencia/vidriera/vista";
import type { VidrieraPublica } from "../../../src/puertos/vidriera-publica";
import { vidrieraPublicaFalsa } from "./vidriera-publica-falsa";

/**
 * Lo que las páginas de la carta piden al servidor (C-2). Es el único lugar que elige la implementación del
 * puerto `VidrieraPublica`: hoy el falso con las cartas de ejemplo; C-3 pone el adaptador real (la puerta pública
 * de la base) y no cambia nada de lo de abajo. Tampoco hay vocabulario de marca todavía (W4): los textos son
 * los del catálogo.
 */
const vidrieras: VidrieraPublica = vidrieraPublicaFalsa;

/** Los textos de la carta cuando no hay una carta a mano (las pantallas de «no está»). */
export function textosPorDefectoDeLaVidriera(): TextosDeVidriera {
  return textosDeVidriera({});
}

export type VidrieraParaLaPantalla = Readonly<{ vista: VistaDeVidriera; textos: TextosDeVidriera }>;

/**
 * El camino de la carta en la dirección pública. En el host compartido es `/<código>`; en el host dedicado
 * es vacío. Hasta que W4 resuelva el host, siempre es el compartido (ASUMIDO: se cambia acá, en un lugar).
 */
function rutaPublicaDe(codigo: string): string {
  return `/${encodeURIComponent(codigo)}`;
}

/**
 * La carta lista para pintar, o `null` si no existe en ESA marca (misma respuesta para cualquier código malo).
 * `marcaId` es el de la puerta resuelta para el host del pedido (`exigirPuerta("CARTA")`), nunca un dato del cliente (S2).
 */
export async function vidrieraParaLaPantalla(
  marcaId: string,
  codigo: string,
): Promise<VidrieraParaLaPantalla | null> {
  const vidriera = await vidrieras.porCodigo(marcaId, codigo);
  if (vidriera === null) return null;
  return {
    vista: armarVistaDeVidriera(vidriera, rutaPublicaDe(codigo)),
    textos: textosDeVidriera({}),
  };
}

/** Un producto de la carta por el último tramo de su dirección (`<slug>-<h8>`), o `null` si ya no está. */
export async function productoParaLaPantalla(
  marcaId: string,
  codigo: string,
  segmento: string,
): Promise<(VidrieraParaLaPantalla & Readonly<{ producto: VistaDeProducto }>) | null> {
  const vidriera = await vidrieras.porCodigo(marcaId, codigo);
  if (vidriera === null) return null;
  const vista = armarVistaDeVidriera(vidriera, rutaPublicaDe(codigo));
  const resuelto = resolverProductoPorSegmento(
    vidriera.id,
    vidriera.secciones
      .flatMap((s) => s.productos)
      .map((p) => ({ productoId: p.id, nombre: p.nombre })),
    segmento,
  );
  if (!resuelto.ok) return null;
  const producto = vista.secciones
    .flatMap((s) => s.productos)
    .find((p) => p.segmento === resuelto.valor.direccion.segmento);
  return producto === undefined ? null : { vista, textos: textosDeVidriera({}), producto };
}
