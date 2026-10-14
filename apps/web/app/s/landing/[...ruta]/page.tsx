import { notFound } from "next/navigation";
import { exigirPuerta } from "../../../../servidor/pedido";

// Cualquier ruta de la landing que no sea la raíz es un 404 de la landing (`../not-found.tsx`).
export default async function RutaInexistenteDeLanding(): Promise<never> {
  await exigirPuerta("LANDING");
  notFound();
}
