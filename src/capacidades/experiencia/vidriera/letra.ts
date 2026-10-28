/**
 * El tamaño de la letra de la carta (D10). El comensal no hace zoom: la carta le da un control «Letra» de
 * tres pasos y se acuerda del que eligió. Los tamaños en sí (18, ≈ 22 y ≈ 25 px, siempre en `rem`) viven en
 * el CSS de la plantilla; acá está lo que se puede equivocar con un dato: el valor guardado en el navegador
 * y la perilla `letra_base` de la carta.
 */

/** Los tres pasos del control «Letra», de menor a mayor. */
export const PASOS_DE_LETRA = ["NORMAL", "GRANDE", "MUY_GRANDE"] as const;
export type PasoDeLetra = (typeof PASOS_DE_LETRA)[number];

export const PASO_DE_LETRA_POR_DEFECTO: PasoDeLetra = "NORMAL";

/** La perilla `letra_base` de la carta: el comerciante agranda, nunca baja del mínimo (D10). */
export const LETRAS_BASE = ["NORMAL", "GRANDE"] as const;
export type LetraBase = (typeof LETRAS_BASE)[number];

export const LETRA_BASE_POR_DEFECTO: LetraBase = "NORMAL";

/** La única clave que la carta escribe en el navegador, y solo cuando el comensal toca «Letra». */
export const CLAVE_DE_LETRA_GUARDADA = "pd-vidriera-letra";

/** Estrecha un texto de la base a la perilla; lo desconocido es el valor por defecto, nunca un error. */
export function leerLetraBase(valor: string | null | undefined): LetraBase {
  return (LETRAS_BASE as readonly (string | null | undefined)[]).includes(valor)
    ? (valor as LetraBase)
    : LETRA_BASE_POR_DEFECTO;
}

/**
 * Lo que había guardado en el navegador, como paso. Lo que falta, está viejo o lo escribió otro código
 * (almacenamiento vacío, valor roto) vuelve al paso normal: la carta se lee igual.
 */
export function leerPasoDeLetra(guardado: string | null | undefined): PasoDeLetra {
  return PASOS_DE_LETRA.find((paso) => paso === guardado) ?? PASO_DE_LETRA_POR_DEFECTO;
}
