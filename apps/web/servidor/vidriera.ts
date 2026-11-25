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
import type { AlcanceDelHost } from "../../../src/capacidades/experiencia/puerta";
import { logoPublicoDeLaCarta } from "../../../src/capacidades/experiencia/vidriera/logo-publico";
import type { CartaDeLaLista, VidrieraPublica } from "../../../src/puertos/vidriera-publica";
import { web } from "./composicion";

/**
 * Lo que las páginas de la carta piden al servidor (C-2). Es el único lugar que elige la implementación del
 * puerto `VidrieraPublica`: el adaptador real de la composición (la puerta pública de la base, rol `pedernal_publico`, solo lectura; T3 y T5 de la
 * carta real). Se pide en cada uso (el adaptador se arma perezoso y una sola vez). Tampoco hay vocabulario de marca todavía (W4): los textos son
 * los del catálogo.
 */
const vidrieras = (): VidrieraPublica => web.vidrieraPublica();

/** Los textos de la carta cuando no hay una carta a mano (las pantallas de «no está»). */
export function textosPorDefectoDeLaVidriera(): TextosDeVidriera {
  return textosDeVidriera({});
}

export type VidrieraParaLaPantalla = Readonly<{ vista: VistaDeVidriera; textos: TextosDeVidriera }>;

/**
 * El camino de la carta en la dirección pública. En el host compartido es `/<código>`; en el host dedicado
 * es vacío. Hasta que W4 resuelva el host, siempre es el compartido (ASUMIDO: se cambia acá, en un lugar).
 */
export function rutaPublicaDe(codigo: string): string {
  return `/${encodeURIComponent(codigo)}`;
}

/**
 * La carta lista para pintar, o `null` si no existe en ESA marca (misma respuesta para cualquier código malo).
 * `puerta` es la resuelta para el host del pedido (`exigirPuerta("CARTA")`), nunca un dato del cliente (S2): lleva la marca y el dueño del host, y un host dedicado
 * a una empresa solo sirve la de ella (H-DOM-1). Se pasa ENTERA: no hay forma de pedir una carta sin el dueño.
 */
export async function vidrieraParaLaPantalla(
  puerta: AlcanceDelHost,
  codigo: string,
): Promise<VidrieraParaLaPantalla | null> {
  const vidriera = await vidrieras().porCodigo(puerta, codigo);
  if (vidriera === null) return null;
  return {
    vista: armarVistaDeVidriera(vidriera, rutaPublicaDe(codigo)),
    textos: textosDeVidriera({}),
  };
}

/**
 * Las cartas de la raíz del host (`/` en un host de carta): solo las de la empresa dueña de un host DEDICADO; en el host compartido, siempre vacío (el puerto lo garantiza).
 * `puerta` es la resuelta para el host del pedido (S2), nunca un dato del cliente.
 */
export function cartasDeLaRaiz(puerta: AlcanceDelHost): Promise<readonly CartaDeLaLista[]> {
  return vidrieras().listarDelHost(puerta);
}

/** Un producto de la carta por el último tramo de su dirección (`<slug>-<h8>`), o `null` si ya no está. */
export async function productoParaLaPantalla(
  puerta: AlcanceDelHost,
  codigo: string,
  segmento: string,
): Promise<(VidrieraParaLaPantalla & Readonly<{ producto: VistaDeProducto }>) | null> {
  const vidriera = await vidrieras().porCodigo(puerta, codigo);
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

/**
 * Los bytes del logo de la carta, o `null` (la ruta responde un 404 neutro). La carta se mira con la misma puerta que la página; el resto es `logoPublicoDeLaCarta`.
 * `puerta` es la resuelta para el host del pedido (S2), nunca un dato del cliente.
 */
export async function logoDeLaVidriera(
  puerta: AlcanceDelHost,
  codigo: string,
  tramoDeVersion: string,
): Promise<Uint8Array | null> {
  return logoPublicoDeLaCarta(
    {
      vidriera: vidrieras(),
      traedor: web.imagenesExternas(),
      memoria: web.memoriaDeLogos(),
    },
    puerta,
    codigo,
    tramoDeVersion,
  );
}
