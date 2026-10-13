import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlantillaDeCarta } from "../../../../ui/plantillas/carta/PlantillaDeCarta.cliente";
import { cartaParaLaPantalla } from "../../../../servidor/carta";

type Props = Readonly<{ params: Promise<{ codigo: string }> }>;

// El título es el nombre de la carta tal como lo cargó el comerciante: ningún texto de marca escrito acá.
// Sin indexar hasta que W4 decida por host (la carta solo se indexa en el host dedicado, [02] §5.1).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const carta = await cartaParaLaPantalla((await params).codigo);
  return carta === null
    ? { robots: { index: false, follow: false } }
    : { title: carta.vista.nombre, robots: { index: false, follow: false } };
}

export default async function PaginaDeLaCarta({ params }: Props) {
  const carta = await cartaParaLaPantalla((await params).codigo);
  if (carta === null) notFound();
  return <PlantillaDeCarta vista={carta.vista} textos={carta.textos} />;
}
