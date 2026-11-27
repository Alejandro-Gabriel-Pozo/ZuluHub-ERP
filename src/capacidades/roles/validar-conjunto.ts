import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { accionesObligatorias, type PisosDeAcciones } from "./pisos";

/**
 * VALIDAR UN CONJUNTO DE ACCIONES contra el catálogo, el plan y los pisos (H4b I3, I5, I6). Lo usan los roles propios (con plan) y las
 * versiones de plantilla (sin plan: una plantilla es de la plataforma). Puro; el servidor lo corre al escribir y la base repite
 * lo que puede (forma de la clave, pisos) como segunda línea. Devuelve TODOS los problemas, no el primero: la pantalla los muestra juntos.
 *
 * Previene: dar más de lo que el plan incluye, aflojar un piso y repetir o inventar claves. Todo nace cerrado: lo que no se puede
 * comprobar (una acción sin módulo) se rechaza. Chequeo: `validar-conjunto.test.ts` y `validar-conjunto.propiedades.test.ts`.
 */

/** Tope de acciones por conjunto: copia el CHECK de la base (`cardinality(p_acciones) <= 1000`, DEC-0630). Lo compara `validar-conjunto.test.ts`. */
export const MAXIMO_DE_ACCIONES_POR_CONJUNTO = 1000;

export type MotivoDeConjuntoInvalido =
  | "ACCION_DESCONOCIDA"
  | "ACCION_REPETIDA"
  | "MODULO_FUERA_DEL_PLAN"
  | "RESERVADA_AL_GERENTE"
  | "FALTA_OBLIGATORIA"
  | "DEMASIADAS_ACCIONES";

export type ProblemaDeConjunto = Readonly<{
  /** La acción que lo causa; `null` solo para `DEMASIADAS_ACCIONES`. */
  accion: string | null;
  motivo: MotivoDeConjuntoInvalido;
}>;

export type ContextoDeValidacion = Readonly<{
  /** El módulo dueño de la acción, o `null` si el catálogo no la declara. */
  moduloDeLaAccion: (accion: string) => string | null;
  /** Los módulos cuyas acciones se pueden otorgar (los que el plan incluye). `null`: no hay plan (una plantilla). */
  modulosDelPlan: ReadonlySet<string> | null;
  pisos: PisosDeAcciones;
}>;

/** Las acciones ordenadas y sin repetir si el conjunto es válido; si no, todos los problemas. */
export function validarConjuntoDeAcciones(
  acciones: readonly string[],
  contexto: ContextoDeValidacion,
): Resultado<readonly string[], readonly ProblemaDeConjunto[]> {
  const problemas: ProblemaDeConjunto[] = [];
  if (acciones.length > MAXIMO_DE_ACCIONES_POR_CONJUNTO) {
    problemas.push({ accion: null, motivo: "DEMASIADAS_ACCIONES" });
  }
  const vistas = new Set<string>();
  for (const accion of acciones) {
    if (vistas.has(accion)) {
      problemas.push({ accion, motivo: "ACCION_REPETIDA" });
      continue;
    }
    vistas.add(accion);
    const modulo = contexto.moduloDeLaAccion(accion);
    if (modulo === null) {
      problemas.push({ accion, motivo: "ACCION_DESCONOCIDA" });
      continue;
    }
    if (contexto.modulosDelPlan !== null && !contexto.modulosDelPlan.has(modulo)) {
      problemas.push({ accion, motivo: "MODULO_FUERA_DEL_PLAN" });
    }
    if (contexto.pisos[accion] === "SOLO_GERENTE") {
      problemas.push({ accion, motivo: "RESERVADA_AL_GERENTE" });
    }
  }
  for (const obligatoria of accionesObligatorias(contexto.pisos)) {
    if (!vistas.has(obligatoria))
      problemas.push({ accion: obligatoria, motivo: "FALTA_OBLIGATORIA" });
  }
  return problemas.length === 0 ? ok([...vistas].sort()) : err(problemas);
}
