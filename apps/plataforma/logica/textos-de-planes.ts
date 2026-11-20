import { textoContra } from "../../../src/capacidades/vocabulario/vocabulario";
import {
  TEXTOS_DE_PLATAFORMA,
  type ClaveDeTextoDePlataforma,
} from "../../../src/capacidades/vocabulario/textos-de-plataforma";

/** El texto de la consola por su clave (catálogo `textos-de-plataforma.ts`, aparte del vocabulario de las marcas). Puro: sin Next ni React. */
export const textoDePlanes = (
  clave: ClaveDeTextoDePlataforma,
  valores?: Readonly<Record<string, string | number>>,
): string => textoContra(TEXTOS_DE_PLATAFORMA, {}, clave, valores);
