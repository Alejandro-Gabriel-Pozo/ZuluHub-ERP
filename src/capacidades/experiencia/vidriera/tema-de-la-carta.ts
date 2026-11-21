import { razonDeContraste } from "../../../primitivas/color/contraste";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { CaraDeVidriera } from "./caras";
import { aHsl, colorDeLaCarta, deHsl, type ErrorDeColorDeLaCarta } from "./color-de-la-carta";

/**
 * El tema de una carta: de la CARA y el COLOR que eligió la persona a los colores con que se pinta la carta pública (V1b; maquetas `carta-caras.html` y `carta.html`, función `TEMA.de`, aprobadas el 09/11/2026).
 * Función pura y total: el color pasa por `colorDeLaCarta` (7:1 con su texto, oscureciéndolo si hace falta) y de él salen TODOS los demás, así que ningún par de texto y fondo queda bajo 7:1 (lo comprueba
 * `tema-de-la-carta.propiedades.test.ts` con colores al azar). Los nombres son los tokens que la carta ya usa (`--color-*`, `--accion-primaria-*`, `--acento`): el tema no suma tokens ni reglas de texto nuevas.
 *
 *  - `DIA` (la de siempre) y `BOLICHE`: fondo claro y texto oscuro; el color es la banda de la cabecera (el botón «Ver toda la carta» y los subrayados de las secciones).
 *  - `NOCHE`: toma solo el TONO del color y arma un fondo oscuro; la banda es un tono claro del mismo tono.
 * El logo no se pinta (la CSP solo deja imágenes propias: pregunta pendiente); la cabecera lleva la inicial del nombre.
 */
export type TemaDeLaCarta = Readonly<{
  fondo: string;
  superficie: string;
  texto: string;
  textoSuave: string;
  borde: string;
  foco: string;
  agotado: string;
  acento: string;
  /** El fondo de la cabecera y del botón principal, y el texto que va encima (blanco o negro, lo elige el sistema). */
  primariaFondo: string;
  primariaTexto: string;
}>;

const TINTA = "#1b1f24";
const SUAVE = "#2b333c";
const BORDE_CLARO = "#6b7585";
const FOCO_CLARO = "#111827";
const AGOTADO_CLARO = "#8f1d16";
const BLANCO = "#ffffff";
const NEGRO = "#000000";

const dePorDefecto = (
  banda: string,
  sobre: string,
  fondo: string,
  superficie: string,
): TemaDeLaCarta => ({
  fondo,
  superficie,
  texto: TINTA,
  textoSuave: SUAVE,
  borde: BORDE_CLARO,
  foco: FOCO_CLARO,
  agotado: AGOTADO_CLARO,
  acento: banda,
  primariaFondo: banda,
  primariaTexto: sobre,
});

/** Un rojo claro para «Agotado» que llega a 7:1 sobre la superficie (la más clara de las dos: llegar sobre ella es llegar también sobre el fondo oscuro): se sube la luminosidad de a un punto desde 78 hasta llegar. */
function agotadoDeNoche(superficie: string): string {
  let luminosidad = 78;
  // Stryker disable next-line EqualityOperator,ConditionalExpression: en 100 el candidato es el blanco puro, que llega a 7:1 sobre cualquier superficie de la noche, así que el tope no se alcanza (`<`, `<=` y quitarlo dan el mismo color); y una razón real nunca cae justo en 7.
  while (luminosidad < 100 && razonDeContraste(deHsl(0, 90, luminosidad), superficie) < 7)
    luminosidad++;
  return deHsl(0, 90, luminosidad);
}

/** El matiz del color elegido ya ajustado, y el fondo oscuro, la superficie y los textos claros que salen de él (NOCHE). */
function deNoche(banda: string): TemaDeLaCarta {
  const [matiz] = aHsl(banda);
  const fondo = deHsl(matiz, 38, 10);
  const superficie = deHsl(matiz, 32, 16);
  const claro = deHsl(matiz + 35, 95, 80);
  return {
    fondo,
    superficie,
    texto: deHsl(matiz, 45, 95),
    textoSuave: deHsl(matiz, 30, 82),
    borde: deHsl(matiz, 20, 62),
    foco: deHsl(matiz, 45, 95),
    agotado: agotadoDeNoche(superficie),
    acento: claro,
    primariaFondo: claro,
    primariaTexto: fondo,
  };
}

/** El tema de la cara con el color elegido (`#rrggbb`); un color que no tiene esa forma es el error cerrado de siempre. */
export function temaDeLaCarta(
  cara: CaraDeVidriera,
  elegido: unknown,
): Resultado<TemaDeLaCarta, ErrorDeColorDeLaCarta> {
  const color = colorDeLaCarta(elegido);
  if (!color.ok) return err(color.error);
  const banda = color.valor.hex;
  const sobre = color.valor.textoSobreColor === "BLANCO" ? BLANCO : NEGRO;
  if (cara === "NOCHE") return ok(deNoche(banda));
  if (cara === "BOLICHE") return ok(dePorDefecto(banda, sobre, "#f6f7f4", BLANCO));
  return ok(dePorDefecto(banda, sobre, BLANCO, "#f3f5f7"));
}

/** Las claves del tema y el token CSS de cada una: una sola tabla, para que el CSS y las pruebas no se desfasen. */
export const TOKEN_DE_CADA_COLOR_DEL_TEMA = {
  fondo: "--color-fondo",
  superficie: "--color-superficie",
  texto: "--color-texto",
  textoSuave: "--color-texto-suave",
  borde: "--color-borde",
  foco: "--color-foco",
  agotado: "--color-agotado",
  acento: "--acento",
  primariaFondo: "--accion-primaria-fondo",
  primariaTexto: "--accion-primaria-texto",
} as const satisfies Readonly<Record<keyof TemaDeLaCarta, string>>;

/** `#` y seis hexadecimales en minúsculas: lo único que se escribe en el CSS. */
const COLOR = /^#[0-9a-f]{6}$/;

/**
 * El CSS del tema: `:root{--color-fondo:#rrggbb;…}`. Solo escribe colores `#rrggbb` (los tokens son de la tabla de arriba): lo que no tenga esa forma no se escribe y se devuelve vacío (nunca un
 * CSS a medias). Va en un `<style nonce>` del servidor, como el tema de la marca: la CSP no deja estilos en línea.
 */
export function cssDelTemaDeLaCarta(tema: TemaDeLaCarta): string {
  const lineas: string[] = [];
  for (const [clave, token] of Object.entries(TOKEN_DE_CADA_COLOR_DEL_TEMA)) {
    const valor = tema[clave as keyof TemaDeLaCarta];
    if (typeof valor !== "string" || !COLOR.test(valor)) return "";
    lineas.push(`${token}:${valor}`);
  }
  return `:root{${lineas.join(";")}}`;
}
