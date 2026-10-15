import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * El aspecto de una marca (marcas y planes, §B.3, tramo M7a): cinco datos de LISTA CERRADA que, junto con los
 * cuatro colores del tema, deciden cómo se ve la puerta de la marca. No es CSS libre: cada valor es uno de
 * los de su lista, en MAYÚSCULAS con guion bajo, y la web decide qué estilos le corresponden. Va aparte del
 * tema a propósito: los cuatro `--brand-*` son un contrato fijo de la web (exactamente cuatro puentes de
 * color) y el aspecto no se publica como variable de color.
 *
 * Como el tema, se hereda token por token (marca → padre → abuelo, la misma `resolverDefinicion`), pero a
 * diferencia del tema SIEMPRE tiene un valor: lo que ninguna versión de la cadena define toma el defecto
 * (`ASPECTO_POR_DEFECTO`), así que un aspecto nunca está «incompleto» y no impide confirmar.
 */

export const ESTILOS_DE_ASPECTO = ["CLARO_CON_BORDES", "MODERNO", "CLASICO", "LUDICO"] as const;
export const SUPERFICIES_DE_ASPECTO = ["NEUTRA", "CALIDA", "FRIA"] as const;
export const ESQUINAS_DE_ASPECTO = ["RECTA", "SUAVE", "REDONDEADA"] as const;
export const TITULOS_DE_ASPECTO = ["SANS", "SERIF"] as const;
export const INGRESOS_DE_ASPECTO = ["DIVIDIDO", "CENTRADO", "CON_IMAGEN"] as const;

export type EstiloDeAspecto = (typeof ESTILOS_DE_ASPECTO)[number];
export type SuperficieDeAspecto = (typeof SUPERFICIES_DE_ASPECTO)[number];
export type EsquinasDeAspecto = (typeof ESQUINAS_DE_ASPECTO)[number];
export type TitulosDeAspecto = (typeof TITULOS_DE_ASPECTO)[number];
export type IngresoDeAspecto = (typeof INGRESOS_DE_ASPECTO)[number];

/** Cada token del aspecto con la lista cerrada de sus valores. */
export const LISTAS_DE_ASPECTO = {
  estilo: ESTILOS_DE_ASPECTO,
  superficie: SUPERFICIES_DE_ASPECTO,
  esquinas: ESQUINAS_DE_ASPECTO,
  titulos: TITULOS_DE_ASPECTO,
  ingreso: INGRESOS_DE_ASPECTO,
} as const;

/** Los tokens del aspecto, en este orden (el de las claves de `AspectoCompleto`). */
export const TOKENS_DE_ASPECTO = [
  "estilo",
  "superficie",
  "esquinas",
  "titulos",
  "ingreso",
] as const;
export type TokenDeAspecto = (typeof TOKENS_DE_ASPECTO)[number];

/** El aspecto de una versión: solo los tokens que define; los demás se heredan token por token. */
export type Aspecto = Readonly<{
  estilo?: EstiloDeAspecto;
  superficie?: SuperficieDeAspecto;
  esquinas?: EsquinasDeAspecto;
  titulos?: TitulosDeAspecto;
  ingreso?: IngresoDeAspecto;
}>;

/** Un aspecto con los cinco tokens: lo que ve la web, con la herencia y los defectos aplicados. */
export type AspectoCompleto = Readonly<{
  estilo: EstiloDeAspecto;
  superficie: SuperficieDeAspecto;
  esquinas: EsquinasDeAspecto;
  titulos: TitulosDeAspecto;
  ingreso: IngresoDeAspecto;
}>;

/** Lo que vale cuando ninguna versión de la cadena define el token (ASUMIDO; el dueño corrige). */
export const ASPECTO_POR_DEFECTO: AspectoCompleto = {
  estilo: "CLARO_CON_BORDES",
  superficie: "NEUTRA",
  esquinas: "SUAVE",
  titulos: "SANS",
  ingreso: "CENTRADO",
};

export type ErrorDeAspecto = Readonly<{ codigo: "ASPECTO_INVALIDO"; token: string }>;

export const esTokenDeAspecto = (token: string): token is TokenDeAspecto =>
  (TOKENS_DE_ASPECTO as readonly string[]).includes(token);

/**
 * Valida el aspecto que llega en un borrador: claves de la lista cerrada y, para cada una, un valor de SU
 * lista (distinguiendo mayúsculas). El primer problema se informa con el nombre de la clave que lo trae
 * (`token`, que puede ser una clave ajena: el dato viene de afuera). Un objeto vacío vale: lo que falta
 * hereda o toma el defecto. Devuelve el aspecto con los tokens en el orden de la lista.
 */
export function validarAspecto(
  entrada: Readonly<Record<string, unknown>>,
): Resultado<Aspecto, ErrorDeAspecto> {
  for (const [token, valor] of Object.entries(entrada)) {
    // Un valor que no es texto nunca está en la lista (la comparación es estricta): no hace falta mirarlo aparte.
    if (
      !esTokenDeAspecto(token) ||
      !(LISTAS_DE_ASPECTO[token] as readonly unknown[]).includes(valor)
    ) {
      return err({ codigo: "ASPECTO_INVALIDO", token });
    }
  }
  const aspecto: Partial<Record<TokenDeAspecto, string>> = {};
  for (const token of TOKENS_DE_ASPECTO) {
    const valor = entrada[token];
    if (valor !== undefined) aspecto[token] = valor as string;
  }
  return ok(aspecto as Aspecto);
}

/**
 * El aspecto completo: cada token que `parcial` define y, donde no, el defecto. Devuelve siempre un objeto
 * nuevo (nadie comparte referencia con `ASPECTO_POR_DEFECTO`).
 */
export function completarAspecto(parcial: Aspecto): AspectoCompleto {
  const completo: Record<TokenDeAspecto, string> = { ...ASPECTO_POR_DEFECTO };
  for (const token of TOKENS_DE_ASPECTO) {
    const valor = parcial[token];
    if (valor !== undefined) completo[token] = valor;
  }
  return completo as AspectoCompleto;
}
