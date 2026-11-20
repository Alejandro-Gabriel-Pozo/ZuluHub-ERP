import { texto, textoContra } from "../../../src/capacidades/vocabulario/vocabulario";
import {
  TEXTOS_DE_PLATAFORMA,
  type ClaveDeTextoDePlataforma,
} from "../../../src/capacidades/vocabulario/textos-de-plataforma";

/** El texto de la consola por su clave (catálogo `textos-de-plataforma.ts`, aparte del vocabulario de las marcas). Puro: sin Next ni React. */
export const textoDePlanes = (
  clave: ClaveDeTextoDePlataforma,
  valores?: Readonly<Record<string, string | number>>,
): string => textoContra(TEXTOS_DE_PLATAFORMA, {}, clave, valores);

/** Los textos del núcleo (ya aprobados, patrones de conexión, envío y estados de W2) que la pantalla reusa en vez de inventar los suyos. */
export const textoDelNucleo = (
  clave: "conexion.no_se_puede_enviar" | "conexion.verificando" | "estado.error_titulo",
): string => texto({}, clave);
