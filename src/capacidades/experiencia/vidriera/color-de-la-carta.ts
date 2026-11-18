import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { COLOR_RRGGBB, razonDeContraste } from "../../../primitivas/color/contraste";

/**
 * El color de la carta con control de contraste (dueño, 16/11/2026: colores libres con «Otro color» y
 * contraste MÍNIMO 7:1; CYN 101 y 107, 09/11). Se guarda el color ELEGIDO; el ajustado se calcula al armar
 * la vista y no se guarda (así se puede subir el mínimo después sin migrar datos). La razón de contraste y la
 * forma `#rrggbb` NO se reescriben acá: son las de `modulos/marcas` (una regla, un lugar). Lo nuevo es el
 * mínimo de la carta, la elección del texto y el oscurecer conservando el tono (que antes solo existía en la
 * maqueta `carta-caras.html`, función `principal`). Previene: una carta ilegible por un color mal elegido.
 */

/** Contraste mínimo del texto sobre el color de la carta (CYN 101 y 107, «ok» del dueño el 09/11). */
export const CONTRASTE_MINIMO_DE_LA_CARTA = 7;

/** El texto que se pone sobre el color: lo elige el sistema, nunca la persona. */
export type TextoSobreColor = "BLANCO" | "NEGRO";

export type ColorDeLaCarta = Readonly<{
  /** El color a usar: el elegido si ya llega a 7:1, o el elegido oscurecido con el mismo tono. `#rrggbb` en minúsculas. */
  hex: string;
  textoSobreColor: TextoSobreColor;
  /** `true` si hubo que oscurecer el color elegido (la pantalla avisa; guardar sigue permitido). */
  ajustado: boolean;
  /** Razón de contraste de `hex` con su texto, truncada (no redondeada) a 2 decimales: nunca informa más de lo real. */
  contraste: number;
}>;

export type ErrorDeColorDeLaCarta = Readonly<{ codigo: "COLOR_DE_CARTA_INVALIDO" }>;

const BLANCO = "#ffffff";
const NEGRO = "#000000";

/** Hasta dónde se baja la luminosidad (en puntos de HSL, de a uno): cerca del negro, donde ya no hay tono que cuidar. */
const LUMINOSIDAD_MINIMA = 4;

const canal = (hex: string, inicio: number): number =>
  Number.parseInt(hex.slice(inicio, inicio + 2), 16);

/** `#rrggbb` → [matiz 0-360, saturación 0-100, luminosidad 0-100]. */
function aHsl(hex: string): readonly [number, number, number] {
  const r = canal(hex, 1) / 255;
  const g = canal(hex, 3) / 255;
  const b = canal(hex, 5) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}

/** [matiz, saturación, luminosidad] → `#rrggbb` en minúsculas (cada canal redondeado al entero más cercano). */
function deHsl(matiz: number, saturacion: number, luminosidad: number): string {
  const s = saturacion / 100;
  const l = luminosidad / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + matiz / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  const dosDigitos = (v: number): string =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${dosDigitos(f(0))}${dosDigitos(f(8))}${dosDigitos(f(4))}`;
}

/** Blanco o negro, el que más contraste da; si empatan, blanco (igual que la maqueta). */
function textoSobre(hex: string): TextoSobreColor {
  return razonDeContraste(hex, BLANCO) >= razonDeContraste(hex, NEGRO) ? "BLANCO" : "NEGRO";
}

const colorDelTexto = (texto: TextoSobreColor): string => (texto === "BLANCO" ? BLANCO : NEGRO);

/** Trunca a 2 decimales (el `+ 1e-9` absorbe el error binario de productos como 7,01 · 100). */
const truncarADosDecimales = (razon: number): number => Math.floor(razon * 100 + 1e-9) / 100;

function armar(hex: string, ajustado: boolean): ColorDeLaCarta {
  const textoSobreColor = textoSobre(hex);
  return {
    hex,
    textoSobreColor,
    ajustado,
    contraste: truncarADosDecimales(razonDeContraste(hex, colorDelTexto(textoSobreColor))),
  };
}

/**
 * Lo que la carta usa para el color elegido. Función pura y total: lo que no es exactamente `#` y seis
 * hexadecimales (mayúsculas o minúsculas) vuelve como error cerrado, sin lanzar y sin adivinar un color.
 * Si el color elegido llega a 7:1 con su texto, se devuelve igual (en minúsculas). Si no, se baja la
 * luminosidad de a un punto, conservando matiz y saturación, hasta llegar a 7:1 con texto BLANCO; el tope es
 * el negro puro (21:1), así que siempre termina y la carta nunca queda ilegible.
 */
export function colorDeLaCarta(elegido: unknown): Resultado<ColorDeLaCarta, ErrorDeColorDeLaCarta> {
  if (typeof elegido !== "string") return err({ codigo: "COLOR_DE_CARTA_INVALIDO" });
  const hex = elegido.toLowerCase();
  if (!COLOR_RRGGBB.test(hex)) return err({ codigo: "COLOR_DE_CARTA_INVALIDO" });

  const textoElegido = colorDelTexto(textoSobre(hex));
  if (razonDeContraste(hex, textoElegido) >= CONTRASTE_MINIMO_DE_LA_CARTA)
    return ok(armar(hex, false));

  const [matiz, saturacion, luminosidad] = aHsl(hex);
  for (let l = Math.floor(luminosidad); l >= LUMINOSIDAD_MINIMA; l--) {
    const candidato = deHsl(matiz, saturacion, l);
    if (razonDeContraste(candidato, BLANCO) >= CONTRASTE_MINIMO_DE_LA_CARTA) {
      return ok(armar(candidato, true));
    }
  }
  return ok(armar(NEGRO, true));
}
