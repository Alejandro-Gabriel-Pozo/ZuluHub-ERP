import type { ClaveDeTexto } from "../../../capacidades/vocabulario/catalogo";
import {
  TOKENS_DE_ASPECTO,
  completarAspecto,
  type AspectoCompleto,
  type TokenDeAspecto,
} from "./aspecto";
import { resolverDefinicion, type DefinicionDeMarca, type DefinicionResuelta } from "./definicion";
import { TOKENS_DE_TEMA, type TokenDeTema } from "./tema";

/**
 * La definición EFECTIVA de una marca con el ORIGEN de cada campo (marcas y planes §B.3; consola de
 * plataforma): qué rige y de dónde sale. Dominio puro, sin reloj ni azar.
 *
 * Una sola fuente de la herencia: el valor sale SIEMPRE de `resolverDefinicion` sobre la cadena entera, y
 * el origen se averigua preguntándole a la MISMA función qué dice cada eslabón por sí solo
 * (`resolverDefinicion([eslabón])`). Así «qué cuenta como definido» (un token del tema, un reemplazo de
 * vocabulario válido, `[]` en los módulos iniciales) lo decide `resolverDefinicion` y nunca se reimplementa
 * acá; una propiedad comprueba que el valor resuelto es el del eslabón que se informa como origen.
 */

/**
 * De dónde sale un campo, según la posición en la cadena `[marca, padre, abuelo]`:
 *  - `propio`: lo define el primer eslabón (la propia definición);
 *  - `heredado`: lo define el eslabón `eslabon` (1 = el padre, 2 = el abuelo) y los anteriores no;
 *  - `defecto`: ningún eslabón lo define. Rige el valor por defecto del aspecto o, si no hay uno (el
 *    nombre, el logo, un color, los módulos iniciales, el plan), el campo queda sin definir.
 */
export type OrigenEnLaCadena =
  | Readonly<{ tipo: "propio" }>
  | Readonly<{ tipo: "heredado"; eslabon: number }>
  | Readonly<{ tipo: "defecto" }>;

export type OrigenesDeLaDefinicion = Readonly<{
  nombreVisible: OrigenEnLaCadena;
  tema: Readonly<Record<TokenDeTema, OrigenEnLaCadena>>;
  aspecto: Readonly<Record<TokenDeAspecto, OrigenEnLaCadena>>;
  logo: OrigenEnLaCadena;
  /** Solo los textos que algún eslabón reemplaza (con un reemplazo válido): los demás rigen por defecto. */
  vocabulario: Readonly<Partial<Record<ClaveDeTexto, OrigenEnLaCadena>>>;
  modulosIniciales: OrigenEnLaCadena;
  planPorDefecto: OrigenEnLaCadena;
}>;

export type DefinicionConOrigen = Readonly<{
  resuelta: DefinicionResuelta;
  /** El aspecto con los defectos aplicados donde ningún eslabón define. */
  aspecto: AspectoCompleto;
  origenes: OrigenesDeLaDefinicion;
}>;

const PROPIO: OrigenEnLaCadena = { tipo: "propio" };
const DEFECTO: OrigenEnLaCadena = { tipo: "defecto" };

/**
 * Resuelve la cadena `[marca, padre, abuelo]` (un eslabón `null` es una marca sin versión vigente y no
 * aporta nada, pero cuenta en la posición) y dice de dónde sale cada campo.
 */
export function resolverConOrigen(
  cadena: readonly (DefinicionDeMarca | null)[],
): DefinicionConOrigen {
  const resuelta = resolverDefinicion(cadena);
  // Lo que cada eslabón dice por sí solo; un eslabón sin versión (`null`) no dice nada, igual que en la cadena.
  const porEslabon = cadena.map((eslabon) => resolverDefinicion([eslabon]));

  /** El origen de un campo: el primer eslabón que lo define, o el defecto. */
  const origenDe = (define: (solo: DefinicionResuelta) => boolean): OrigenEnLaCadena => {
    const indice = porEslabon.findIndex(define);
    if (indice === -1) return DEFECTO;
    return indice === 0 ? PROPIO : { tipo: "heredado", eslabon: indice };
  };

  const tema = {} as Record<TokenDeTema, OrigenEnLaCadena>;
  for (const token of TOKENS_DE_TEMA)
    tema[token] = origenDe((solo) => solo.tema[token] !== undefined);
  const aspecto = {} as Record<TokenDeAspecto, OrigenEnLaCadena>;
  for (const token of TOKENS_DE_ASPECTO) {
    aspecto[token] = origenDe((solo) => solo.aspecto[token] !== undefined);
  }
  const vocabulario: Partial<Record<ClaveDeTexto, OrigenEnLaCadena>> = {};
  for (const texto of Object.keys(resuelta.vocabulario) as ClaveDeTexto[]) {
    vocabulario[texto] = origenDe((solo) => Object.hasOwn(solo.vocabulario, texto));
  }

  return {
    resuelta,
    aspecto: completarAspecto(resuelta.aspecto),
    origenes: {
      nombreVisible: origenDe((solo) => solo.nombreVisible !== null),
      tema,
      aspecto,
      logo: origenDe((solo) => solo.logo !== null),
      vocabulario,
      modulosIniciales: origenDe((solo) => solo.modulosIniciales !== null),
      planPorDefecto: origenDe((solo) => solo.planPorDefectoId !== null),
    },
  };
}
