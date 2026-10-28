import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlantillaDeVidriera } from "../../../../ui/plantillas/vidriera/PlantillaDeVidriera.cliente";
import { vidrieraParaLaPantalla } from "../../../../servidor/vidriera";
import { exigirPuerta } from "../../../../servidor/pedido";

type Props = Readonly<{ params: Promise<{ codigo: string }> }>;

// El título es el nombre de la carta tal como lo cargó el comerciante: ningún texto de marca escrito acá.
// Sin indexar hasta que W4 decida por host (la carta solo se indexa en el host dedicado, [02] §5.1).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // S2: la carta se busca en la marca de ESTE host; en un host que no es de carta, la neutra.
  const puerta = await exigirPuerta("CARTA");
  const vidriera = await vidrieraParaLaPantalla(puerta.marcaId, (await params).codigo);
  return vidriera === null
    ? { robots: { index: false, follow: false } }
    : { title: vidriera.vista.nombre, robots: { index: false, follow: false } };
}

export default async function PaginaDeLaVidriera({ params }: Props) {
  const puerta = await exigirPuerta("CARTA");
  const vidriera = await vidrieraParaLaPantalla(puerta.marcaId, (await params).codigo);
  if (vidriera === null) notFound();
  return <PlantillaDeVidriera vista={vidriera.vista} textos={vidriera.textos} />;
}
