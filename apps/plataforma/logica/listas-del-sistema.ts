/**
 * Las listas del sistema que la consola administra y su dirección. La dirección es un nombre corto (`/listas/marcas`) y no el de la base: lo que llega del
 * navegador se busca acá (lista cerrada) y nunca se pasa tal cual al caso de uso. Una lista nueva se suma en esta tabla y nada más (las dos que existen en el
 * dominio son `MARCAS_DE_TARJETA` y `MOTIVOS_DE_RECHAZO`; por ahora la consola ofrece las marcas, que es lo pedido). Los títulos son los aprobados el 09/11/2026
 * (`listas.html`, «Textos nuevos»: «Listas · Marcas de tarjeta · Motivos de rechazo · … · Valores»).
 */
import type { ListaDelSistema } from "../../../src/modulos/listas/publico";

export const LISTAS_DE_LA_CONSOLA = {
  marcas: { lista: "MARCAS_DE_TARJETA", titulo: "Marcas de tarjeta" },
} as const satisfies Readonly<Record<string, Readonly<{ lista: ListaDelSistema; titulo: string }>>>;

export type NombreDeLista = keyof typeof LISTAS_DE_LA_CONSOLA;

export type ListaDeLaConsola = Readonly<{
  nombre: NombreDeLista;
  lista: ListaDelSistema;
  titulo: string;
}>;

export const NOMBRES_DE_LISTAS = Object.keys(LISTAS_DE_LA_CONSOLA) as readonly NombreDeLista[];

/** La lista de ese nombre, o `null` (un nombre que no está en la tabla, ni heredado ni de otro tipo, no es una lista). */
export function listaDeLaConsola(nombre: unknown): ListaDeLaConsola | null {
  if (typeof nombre !== "string" || !Object.hasOwn(LISTAS_DE_LA_CONSOLA, nombre)) return null;
  const clave = nombre as NombreDeLista;
  return { nombre: clave, ...LISTAS_DE_LA_CONSOLA[clave] };
}
