import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ListaDeCartasDeLaRaiz } from "../../../ui/plantillas/vidriera/ListaDeCartasDeLaRaiz";
import { PlantillaNeutra } from "../../../ui/plantillas/PlantillaNeutra";
import { METADATOS_DE_CARTA_NO_DISPONIBLE } from "../../../servidor/metadatos-de-carta";
import { exigirPuerta } from "../../../servidor/pedido";
import { cartasDeLaRaiz, rutaPublicaDe } from "../../../servidor/vidriera";

// La raíz no se indexa en ningún caso (el host de una empresa tampoco: `CARTA_INDEXABLE_SEGUN_DUENIO`): los mismos metadatos que la carta que no está.
export const metadata: Metadata = METADATOS_DE_CARTA_NO_DISPONIBLE;

/**
 * `/` en un host de carta (P3 del dominio propio). Con el alcance de la puerta (S2, H-DOM-1; nunca un dato del navegador):
 *  - UNA carta en línea de la empresa dueña del host: redirección 307 a `/<código>` (temporal: mañana puede haber otra);
 *  - VARIAS: la lista, con el nombre, el rubro y el lugar de cada una;
 *  - NINGUNA, o un host compartido (dueño: la marca): la 404 neutra de siempre. El host compartido no lista cartas ajenas.
 */
export default async function RaizDeLaCarta() {
  const puerta = await exigirPuerta("CARTA");
  const cartas = await cartasDeLaRaiz(puerta);
  const [unica] = cartas;
  if (unica === undefined) notFound();
  if (cartas.length === 1) redirect(rutaPublicaDe(unica.codigo));
  return (
    <PlantillaNeutra titulo={puerta.marca.nombre}>
      <ListaDeCartasDeLaRaiz cartas={cartas} rutaDe={rutaPublicaDe} />
    </PlantillaNeutra>
  );
}
