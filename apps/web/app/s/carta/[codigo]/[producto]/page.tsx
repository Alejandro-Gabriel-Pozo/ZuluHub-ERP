import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContenedorDeLetra } from "../../../../../ui/plantillas/vidriera/ContenedorDeLetra.cliente";
import { PaginaDeProducto } from "../../../../../ui/plantillas/vidriera/PaginaDeProducto";
import { productoParaLaPantalla } from "../../../../../servidor/vidriera";
import {
  METADATOS_DE_CARTA_NO_DISPONIBLE,
  metadatosDeLaCarta,
} from "../../../../../servidor/metadatos-de-carta";
import { exigirPuerta } from "../../../../../servidor/pedido";

type Props = Readonly<{ params: Promise<{ codigo: string; producto: string }> }>;

// «{producto} · {carta}», siempre sin indexar (decenas de páginas casi iguales a la carta) y sin descripción propia (no hay texto aprobado): lo arma `metadatosDeLaCarta` (C3).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { codigo, producto } = await params;
  // S2 y H-DOM-1: la carta se busca en la marca y en el dueño de ESTE host (la puerta entera); en un host que no es de carta, la neutra.
  const puerta = await exigirPuerta("CARTA");
  const datos = await productoParaLaPantalla(puerta, codigo, producto);
  if (datos === null) return METADATOS_DE_CARTA_NO_DISPONIBLE;
  return metadatosDeLaCarta(
    puerta,
    {
      tipo: "PRODUCTO",
      nombreDelProducto: datos.producto.nombre,
      nombreDeLaCarta: datos.vista.nombre,
    },
    `${datos.vista.hrefDeLaVidriera.replace(/\/$/, "")}/${encodeURIComponent(datos.producto.segmento)}`,
  );
}

export default async function PaginaDelProducto({ params }: Props) {
  const { codigo, producto } = await params;
  const puerta = await exigirPuerta("CARTA");
  const datos = await productoParaLaPantalla(puerta, codigo, producto);
  if (datos === null) notFound();
  const { vista, textos } = datos;
  return (
    <ContenedorDeLetra letraBase={vista.letraBase}>
      <PaginaDeProducto
        producto={datos.producto}
        vidriera={vista.nombre}
        hrefDeLaVidriera={`${vista.hrefDeLaVidriera}#${datos.producto.seccion}`}
        textos={textos}
      />
    </ContenedorDeLetra>
  );
}
