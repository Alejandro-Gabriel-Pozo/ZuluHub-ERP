import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  COLOR_RRGGBB,
  luminanciaRelativa,
  razonDeContraste,
} from "../../../primitivas/color/contraste";
import type { SuperficieDeAspecto } from "./aspecto";

export { luminanciaRelativa, razonDeContraste };

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
export { COLOR_RRGGBB as COLOR_DEL_TEMA };

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
    if (!esTokenDeTema(token) || typeof valor !== "string" || !COLOR_RRGGBB.test(valor)) {
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

/** ¿Alcanza el contraste mínimo? Igual al mínimo pasa (WCAG: «al menos»). */
export const contrasteSuficiente = (a: string, b: string, minimo: number): boolean =>
  razonDeContraste(a, b) >= minimo;

/**
 * Los dos colores de fondo de cada superficie del aspecto (valores de los prototipos aprobados, los mismos
 * de `tokens.css` de la web): `fondo` es el de la página y `superficie` el de las tarjetas y paneles.
 */
export const COLORES_DE_SUPERFICIE: Readonly<
  Record<SuperficieDeAspecto, Readonly<{ fondo: string; superficie: string }>>
> = {
  NEUTRA: { fondo: "#ffffff", superficie: "#f3f5f7" },
  CALIDA: { fondo: "#fbf7f1", superficie: "#f3eadc" },
  FRIA: { fondo: "#f5f8fc", superficie: "#e6edf6" },
};

/** Texto normal (WCAG 1.4.3, nivel AA): `on-primary` sobre `primary`. */
export const CONTRASTE_MINIMO_DEL_TEXTO = 4.5;
/** Componentes gráficos y texto grande (WCAG 1.4.11): `accent` sobre el fondo y sobre la superficie. */
export const CONTRASTE_MINIMO_DEL_ACENTO = 3;

export type ParDeContraste = "on-primary/primary" | "accent/fondo" | "accent/superficie";

/** La medición de UN par de colores: lo que se pide, lo que da y si alcanza. */
export type ContrasteDeUnPar = Readonly<{
  par: ParDeContraste;
  /** La razón WCAG entre los dos colores, SIN redondear (4,499 no pasa por 4,5); `null` si falta alguno de los dos. */
  razon: number | null;
  /** Lo mínimo que se exige a este par. */
  minimo: number;
  /** `razon >= minimo`; `null` si el par no se puede medir porque el tema no define alguno de sus colores. */
  cumple: boolean | null;
}>;

/**
 * La medición de los tres pares del tema contra la SUPERFICIE elegida en el aspecto (marcas y planes §B.3):
 * `on-primary` sobre `primary` a 4,5:1 y `accent` a 3:1 sobre el fondo y sobre la superficie de esa superficie.
 * Es la única definición de los pares y de sus mínimos: la confirmación (`parDeContrasteInsuficiente`) y la
 * vista previa de la consola leen de acá. A diferencia de la confirmación, acepta un tema INCOMPLETO (un
 * borrador): el par que necesita un color que falta sale sin medir (`razon` y `cumple` nulos). `secondary` no
 * se mide: no lleva texto ni se usa como único comunicador de un estado.
 */
export function contrastesDelTema(
  tema: Tema,
  superficie: SuperficieDeAspecto,
): readonly ContrasteDeUnPar[] {
  const colores = COLORES_DE_SUPERFICIE[superficie];
  const medir = (
    par: ParDeContraste,
    a: string | undefined,
    b: string | undefined,
    minimo: number,
  ): ContrasteDeUnPar =>
    a === undefined || b === undefined
      ? { par, razon: null, minimo, cumple: null }
      : { par, razon: razonDeContraste(a, b), minimo, cumple: contrasteSuficiente(a, b, minimo) };
  return [
    medir("on-primary/primary", tema["on-primary"], tema.primary, CONTRASTE_MINIMO_DEL_TEXTO),
    medir("accent/fondo", tema.accent, colores.fondo, CONTRASTE_MINIMO_DEL_ACENTO),
    medir("accent/superficie", tema.accent, colores.superficie, CONTRASTE_MINIMO_DEL_ACENTO),
  ];
}

/**
 * Al confirmar (§B.3): devuelve el primer par que no llega, o `null` si el tema deja todo legible. Es el
 * primero de `contrastesDelTema` cuyo `cumple` es `false`.
 */
export function parDeContrasteInsuficiente(
  tema: TemaCompleto,
  superficie: SuperficieDeAspecto,
): ParDeContraste | null {
  return contrastesDelTema(tema, superficie).find((c) => c.cumple === false)?.par ?? null;
}
