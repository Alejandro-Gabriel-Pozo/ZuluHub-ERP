import { notFound } from "next/navigation";
import { exigirPuerta } from "../../../../servidor/pedido";

// Todavía no hay pantallas de la aplicación (llegan con el ingreso, W5): todo es un 404 de la app
// (`../not-found.tsx`). W5 suma sus rutas al lado y esta atrapa-todo sigue atajando lo que no exista.
export default async function RutaInexistenteDeApp(): Promise<never> {
  await exigirPuerta("APP");
  notFound();
}
