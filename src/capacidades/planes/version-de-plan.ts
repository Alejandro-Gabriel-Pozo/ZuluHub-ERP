import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { esClaveDe } from "../modulos/activos";
import type { DefinicionDeModulo } from "../modulos/catalogo";
import type { DefinicionDePerilla } from "./perillas";
import { esValorDeLaPerilla, estaEncendida, valorBaseDe, type ValorDePerilla } from "./valores";

/**
 * Validación de una versión de plan al publicarla (marcas y planes, §B.5.2). Una versión publicada
 * congela: el nombre comercial, los módulos incluidos (el techo) y los valores de perillas (las que
 * no figuran valen la base). Los planes no tienen precio. Pura: no escribe nada ni decide el número
 * de la versión (lo da la base al publicar).
 */

/** Lo más largo que puede ser el nombre comercial de un plan. */
export const LARGO_MAXIMO_DEL_NOMBRE_DE_PLAN = 60;

/** Lo que llega a validar: datos sin tipar (vienen de la consola o de un borrador guardado). */
export type ContenidoDeVersionDePlan = Readonly<{
  nombreComercial: string;
  modulos: readonly string[];
  perillas: Readonly<Record<string, unknown>>;
}>;

/** Lo que se congela: el nombre recortado, los módulos sin repetir y ordenados, los valores tipados. */
export type VersionDePlanValida = Readonly<{
  nombreComercial: string;
  modulos: readonly string[];
  perillas: Readonly<Record<string, ValorDePerilla>>;
}>;

export type ErrorDeVersionDePlan =
  | Readonly<{ codigo: "NOMBRE_DE_PLAN_INVALIDO" }>
  | Readonly<{ codigo: "MODULO_DESCONOCIDO"; modulo: string }>
  | Readonly<{ codigo: "REQUIERE_FALTANTE"; modulo: string; requiere: string }>
  | Readonly<{ codigo: "PERILLA_DESCONOCIDA"; perilla: string }>
  | Readonly<{ codigo: "VALOR_DE_PERILLA_INVALIDO"; perilla: string }>
  | Readonly<{ codigo: "PERILLA_REQUIERE_OTRA"; perilla: string; requiere: string }>;

/** Caracteres de control, de formato (ancho cero, marcas bidireccionales), separadores de línea y sin asignar. */
const CARACTER_NO_IMPRIMIBLE = /[\p{C}\p{Zl}\p{Zp}]/u;

/**
 * El nombre comercial: texto recortado de 1 a 60 caracteres, sin caracteres de control ni de formato
 * (el nombre se muestra tal cual; un ancho cero o una marca bidireccional lo falsificarían).
 */
export function nombreDePlanValido(nombre: string): string | null {
  const limpio = nombre.trim();
  if (limpio === "" || [...limpio].length > LARGO_MAXIMO_DEL_NOMBRE_DE_PLAN) return null;
  return CARACTER_NO_IMPRIMIBLE.test(limpio) ? null : limpio;
}

/**
 * Valida el contenido de una versión de plan. Orden de los errores: nombre, módulos desconocidos (en
 * el orden dado), clausura de `requiere` de módulos (por módulo, ordenados), perillas por clave
 * (desconocida, valor del tipo equivocado) y, al final, `requiere` entre perillas.
 *
 * Decisiones:
 *  - un módulo obligatorio cuenta como incluido para la clausura (todo plan lo tiene);
 *  - `PERILLA_REQUIERE_OTRA` se mira solo en las perillas que el plan fija ENCENDIDAS: la requerida
 *    vale lo que el plan dice, o su base si no figura. Una perilla que el plan no menciona no se
 *    rechaza (su valor efectivo queda apagado mientras la requerida lo esté: `derechosDeUso`).
 */
export function validarVersionDePlan<M extends string, P extends string>(
  catalogoDeModulos: Readonly<Record<M, Pick<DefinicionDeModulo, "obligatorio" | "requiere">>>,
  catalogoDePerillas: Readonly<Record<P, DefinicionDePerilla>>,
  contenido: ContenidoDeVersionDePlan,
): Resultado<VersionDePlanValida, ErrorDeVersionDePlan> {
  const nombreComercial = nombreDePlanValido(contenido.nombreComercial);
  if (nombreComercial === null) return err({ codigo: "NOMBRE_DE_PLAN_INVALIDO" });

  for (const modulo of contenido.modulos) {
    if (!esClaveDe(catalogoDeModulos, modulo)) return err({ codigo: "MODULO_DESCONOCIDO", modulo });
  }
  const modulos = [...new Set(contenido.modulos)].sort();
  for (const modulo of modulos) {
    for (const requiere of catalogoDeModulos[modulo as M].requiere) {
      const incluido =
        modulos.includes(requiere) ||
        (esClaveDe(catalogoDeModulos, requiere) && catalogoDeModulos[requiere].obligatorio);
      if (!incluido) return err({ codigo: "REQUIERE_FALTANTE", modulo, requiere });
    }
  }

  const claves = Object.keys(contenido.perillas).sort();
  const perillas = new Map<string, ValorDePerilla>();
  for (const perilla of claves) {
    if (!esClaveDe(catalogoDePerillas, perilla)) {
      return err({ codigo: "PERILLA_DESCONOCIDA", perilla });
    }
    const valor = contenido.perillas[perilla];
    if (!esValorDeLaPerilla(catalogoDePerillas[perilla], valor)) {
      return err({ codigo: "VALOR_DE_PERILLA_INVALIDO", perilla });
    }
    perillas.set(perilla, valor);
  }

  for (const [perilla, valor] of perillas) {
    const requiere = catalogoDePerillas[perilla as P].requiere;
    if (requiere === undefined || !estaEncendida(valor)) continue;
    const delPlan = perillas.get(requiere);
    const base = esClaveDe(catalogoDePerillas, requiere)
      ? valorBaseDe(catalogoDePerillas[requiere])
      : undefined;
    const requerida = delPlan ?? base;
    if (requerida === undefined || !estaEncendida(requerida)) {
      return err({ codigo: "PERILLA_REQUIERE_OTRA", perilla, requiere });
    }
  }
  return ok({ nombreComercial, modulos, perillas: Object.fromEntries(perillas) });
}
