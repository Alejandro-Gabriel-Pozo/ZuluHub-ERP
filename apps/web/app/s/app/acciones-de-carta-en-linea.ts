"use server";

import type { ResultadoDeAccion } from "../../../servidor/acciones";
import {
  cambiarElEstadoDeLaCarta,
  guardarLosTextosDeLaCarta,
} from "../../../servidor/carta-en-linea";

// Las acciones de servidor de «Carta en línea», expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"` tiene que ser lo primero de este archivo, así que lo que hacen vive
// en `servidor/carta-en-linea.ts`. Reciben el estado anterior que pasa `useActionState`. La carta (o su clave de creación), la sucursal que se mostró, su versión y el estado que se pide se ligan con
// `.bind` al armar la página: Next los cifra, no viajan en un campo. La empresa y la persona no viajan: las decide el servidor.

/** Guardar los textos: lo que la página ligó (la carta, la sucursal mostrada y la versión vista; `null` si la carta es nueva) y el formulario. */
export async function guardarLosTextosAccion(
  ligado: Readonly<{ cartaId: string; sucursalId: string; versionEsperada: number | null }>,
  previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  void previo;
  return guardarLosTextosDeLaCarta(ligado, datos);
}

/** Poner en línea o sacar de línea: el estado que se pide viaja ligado, no en el formulario. */
export async function estadoDeLaCartaAccion(
  ligado: Readonly<{
    cartaId: string;
    sucursalId: string;
    versionEsperada: number;
    estado: "EN_LINEA" | "FUERA_DE_LINEA";
  }>,
  previo: ResultadoDeAccion,
): Promise<ResultadoDeAccion> {
  void previo;
  return cambiarElEstadoDeLaCarta(ligado);
}
