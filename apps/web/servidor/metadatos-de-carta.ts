import "server-only";

import type { Metadata } from "next";
import type { PuertaResuelta } from "../../../src/capacidades/experiencia/puerta";
import {
  metadatosDePagina,
  type MetadatosDePagina,
  type PaginaDeCarta,
} from "../../../src/capacidades/experiencia/metadatos";
import { puertaEsIndexable } from "./pedido";

/**
 * Lo que la carta le entrega al `<head>` (C3): traduce el resultado de `metadatosDePagina` al formato de Next. Es el único lugar que arma `title`,
 * `description`, Open Graph y `robots` de la carta y del producto; las páginas no escriben ninguno por su cuenta (una regla, un lugar).
 * Los metadatos para COMPARTIR (Open Graph) salen aunque la página no se indexe (maqueta `seo-y-metadatos.html`, estado «Dominio compartido»:
 * «NO aparece en buscadores, pero sí se ve bien al compartir el enlace»). Next escapa el texto al emitirlo.
 */

/** La carta que no existe, está fuera de línea o es de otra marca: los mismos bytes en todos los casos, siempre sin indexar y sin Open Graph. */
export const METADATOS_DE_CARTA_NO_DISPONIBLE: Metadata = Object.freeze({
  robots: { index: false, follow: false },
});

export function metadatosDeLaCarta(
  puerta: PuertaResuelta,
  pagina: PaginaDeCarta,
  ruta: string,
): Metadata {
  // Hoy no hay de dónde sacar el logo de la marca con su ancho (la puerta pública no lo trae): sin imagen, que es lo aprobado para «no llega al tamaño».
  const m: MetadatosDePagina = metadatosDePagina({
    pagina,
    sitio: puerta.marca.nombre,
    host: puerta.host,
    ruta,
    superficieIndexable: puertaEsIndexable(puerta),
    imagen: null,
  });
  const imagenes = m.imagen === null ? [] : [{ url: m.imagen.url, width: m.imagen.ancho }];
  const descripcion = m.descripcion === null ? {} : { description: m.descripcion };
  return {
    title: m.titulo,
    ...descripcion,
    alternates: { canonical: m.canonica },
    robots: { index: m.indexable, follow: m.indexable },
    openGraph: {
      type: "website",
      title: m.titulo,
      ...descripcion,
      url: m.canonica,
      siteName: m.nombreDelSitio,
      locale: m.idioma,
      ...(imagenes.length > 0 ? { images: imagenes } : {}),
    },
    twitter: {
      card: imagenes.length > 0 ? "summary_large_image" : "summary",
      title: m.titulo,
      ...descripcion,
      ...(imagenes.length > 0 ? { images: imagenes.map((i) => i.url) } : {}),
    },
  };
}
