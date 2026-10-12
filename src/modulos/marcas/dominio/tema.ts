import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * Los únicos tokens de color de una marca (marcas y planes, §B.3): una lista CERRADA, sin CSS libre. Cada
 * uno se publica como una variable `--brand-<token>`.
 */
export const TOKENS_DE_TEMA = ["primary", "on-primary", "secondary", "accent"] as const;
export type TokenDeTema = (typeof TOKENS_DE_TEMA)[number];

/** El tema de una versión: solo los tokens que define; los demás se heredan token por token. */
export type Tema = Readonly<Partial<Record<TokenDeTema, string>>>;

/** Un tema con todos los tokens: lo que tiene que quedar al resolver la herencia para confirmar. */
export type TemaCompleto = Readonly<Record<TokenDeTema, string>>;

export type ErrorDeTema = Readonly<{ codigo: "TEMA_INVALIDO"; token: string }>;

/** Un color es `#rrggbb` con letras minúsculas: nada de `#fff`, `rgb()`, `url()` ni nombres. */
const COLOR = /^#[0-9a-f]{6}$/;

export const esTokenDeTema = (token: string): token is TokenDeTema =>
  (TOKENS_DE_TEMA as readonly string[]).includes(token);

/**
 * Valida el tema que llega en un borrador: claves de la lista cerrada y valores `#rrggbb` en minúsculas.
 * El primer problema se informa con el nombre de la clave que lo trae (`token`, que puede ser una clave
 * ajena: el dato viene de afuera). Devuelve el tema con los tokens en el orden de la lista.
 */
export function validarTema(
  entrada: Readonly<Record<string, unknown>>,
): Resultado<Tema, ErrorDeTema> {
  for (const [token, valor] of Object.entries(entrada)) {
    if (!esTokenDeTema(token) || typeof valor !== "string" || !COLOR.test(valor)) {
      return err({ codigo: "TEMA_INVALIDO", token });
    }
  }
  const tema: Partial<Record<TokenDeTema, string>> = {};
  for (const token of TOKENS_DE_TEMA) {
    const valor = entrada[token];
    if (valor !== undefined) tema[token] = valor as string;
  }
  return ok(tema);
}

/** El canal de dos dígitos hexadecimales que empieza en `inicio` de un `#rrggbb`. */
const canalEn = (color: string, inicio: number): number =>
  Number.parseInt(color.slice(inicio, inicio + 2), 16);

/**
 * Un canal sRGB (0 a 255) pasado a luz lineal (WCAG 2.x). El corte entre el tramo recto y la curva está
 * entre el canal 10 y el 11 (0,03928 · 255 = 10,02), igual que con 0,04045 de la norma sRGB: se compara
 * el canal entero y no el cociente, que nunca cae justo en el corte.
 */
function canalLineal(canal: number): number {
  const c = canal / 255;
  return canal <= 10 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** La luminancia relativa WCAG de un color `#rrggbb`: 0 el negro, 1 el blanco. */
export function luminanciaRelativa(color: string): number {
  return (
    0.2126 * canalLineal(canalEn(color, 1)) +
    0.7152 * canalLineal(canalEn(color, 3)) +
    0.0722 * canalLineal(canalEn(color, 5))
  );
}

/**
 * La razón de contraste WCAG entre dos colores `#rrggbb`, de 1 (iguales) a 21 (negro y blanco). No
 * depende del orden. Sin redondear: 4,499 no pasa por 4,5.
 */
export function razonDeContraste(a: string, b: string): number {
  const la = luminanciaRelativa(a);
  const lb = luminanciaRelativa(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** ¿Alcanza el contraste mínimo? Igual al mínimo pasa (WCAG: «al menos»). */
export const contrasteSuficiente = (a: string, b: string, minimo: number): boolean =>
  razonDeContraste(a, b) >= minimo;

const BLANCO = "#ffffff";

/** Texto normal (WCAG 1.4.3, nivel AA): `on-primary` sobre `primary`. */
export const CONTRASTE_MINIMO_DEL_TEXTO = 4.5;
/** Componentes gráficos y texto grande (WCAG 1.4.11): `accent` sobre blanco. */
export const CONTRASTE_MINIMO_DEL_ACENTO = 3;

export type ParDeContraste = "on-primary/primary" | "accent/blanco";

/**
 * Al confirmar (§B.3): `on-primary` sobre `primary` a 4,5:1 como mínimo y `accent` sobre blanco a 3:1.
 * Devuelve el primer par que no llega, o `null` si el tema deja todo legible. `secondary` no se mide:
 * no lleva texto ni se usa como único comunicador de un estado.
 */
export function parDeContrasteInsuficiente(tema: TemaCompleto): ParDeContraste | null {
  if (!contrasteSuficiente(tema["on-primary"], tema.primary, CONTRASTE_MINIMO_DEL_TEXTO)) {
    return "on-primary/primary";
  }
  if (!contrasteSuficiente(tema.accent, BLANCO, CONTRASTE_MINIMO_DEL_ACENTO)) {
    return "accent/blanco";
  }
  return null;
}
