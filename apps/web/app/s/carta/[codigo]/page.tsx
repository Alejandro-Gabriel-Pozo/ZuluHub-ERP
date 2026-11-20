import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlantillaDeVidriera } from "../../../../ui/plantillas/vidriera/PlantillaDeVidriera.cliente";
import { vidrieraParaLaPantalla } from "../../../../servidor/vidriera";
import {
  METADATOS_DE_CARTA_NO_DISPONIBLE,
  metadatosDeLaCarta,
} from "../../../../servidor/metadatos-de-carta";
import { exigirPuerta } from "../../../../servidor/pedido";

type Props = Readonly<{ params: Promise<{ codigo: string }> }>;

// Título, descripción, canónica, Open Graph y `robots` los arma `metadatosDeLaCarta` (C3): ningún texto ni regla de indexación escritos acá.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // S2 y H-DOM-1: la carta se busca en la marca y en el dueño de ESTE host (la puerta entera); en un host que no es de carta, la neutra.
  const puerta = await exigirPuerta("CARTA");
  const vidriera = await vidrieraParaLaPantalla(puerta, (await params).codigo);
  if (vidriera === null) return METADATOS_DE_CARTA_NO_DISPONIBLE;
  const { nombre, rubro, lugar, hrefDeLaVidriera } = vidriera.vista;
  return metadatosDeLaCarta(puerta, { tipo: "CARTA", nombre, rubro, lugar }, hrefDeLaVidriera);
}

export default async function PaginaDeLaVidriera({ params }: Props) {
  const puerta = await exigirPuerta("CARTA");
  const vidriera = await vidrieraParaLaPantalla(puerta, (await params).codigo);
  if (vidriera === null) notFound();
  return <PlantillaDeVidriera vista={vidriera.vista} textos={vidriera.textos} />;
}
