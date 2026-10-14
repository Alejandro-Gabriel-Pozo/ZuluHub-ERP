import "server-only";

import { resolverProductoPorSegmento } from "../../../src/capacidades/experiencia/carta/direccion";
import {
  textosDeCarta,
  type TextosDeCarta,
} from "../../../src/capacidades/experiencia/carta/textos";
import {
  armarVistaDeCarta,
  type VistaDeCarta,
  type VistaDeProducto,
} from "../../../src/capacidades/experiencia/carta/vista";
import type { CartaPublica } from "../../../src/puertos/carta-publica";
import { cartaPublicaFalsa } from "./carta-publica-falsa";

/**
 * Lo que las páginas de la carta piden al servidor (C-2). Es el único lugar que elige la implementación del
 * puerto `CartaPublica`: hoy el falso con las cartas de ejemplo; C-3 pone el adaptador real (la puerta pública
 * de la base) y no cambia nada de lo de abajo. Tampoco hay vocabulario de marca todavía (W4): los textos son
 * los del catálogo.
 */
const cartas: CartaPublica = cartaPublicaFalsa;

/** Los textos de la carta cuando no hay una carta a mano (las pantallas de «no está»). */
export function textosPorDefectoDeLaCarta(): TextosDeCarta {
  return textosDeCarta({});
}

export type CartaParaLaPantalla = Readonly<{ vista: VistaDeCarta; textos: TextosDeCarta }>;

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
export async function cartaParaLaPantalla(
  marcaId: string,
  codigo: string,
): Promise<CartaParaLaPantalla | null> {
  const carta = await cartas.porCodigo(marcaId, codigo);
  if (carta === null) return null;
  return { vista: armarVistaDeCarta(carta, rutaPublicaDe(codigo)), textos: textosDeCarta({}) };
}

/** Un producto de la carta por el último tramo de su dirección (`<slug>-<h8>`), o `null` si ya no está. */
export async function productoParaLaPantalla(
  marcaId: string,
  codigo: string,
  segmento: string,
): Promise<(CartaParaLaPantalla & Readonly<{ producto: VistaDeProducto }>) | null> {
  const carta = await cartas.porCodigo(marcaId, codigo);
  if (carta === null) return null;
  const vista = armarVistaDeCarta(carta, rutaPublicaDe(codigo));
  const resuelto = resolverProductoPorSegmento(
    carta.id,
    carta.secciones
      .flatMap((s) => s.productos)
      .map((p) => ({ productoId: p.id, nombre: p.nombre })),
    segmento,
  );
  if (!resuelto.ok) return null;
  const producto = vista.secciones
    .flatMap((s) => s.productos)
    .find((p) => p.segmento === resuelto.valor.direccion.segmento);
  return producto === undefined ? null : { vista, textos: textosDeCarta({}), producto };
}
