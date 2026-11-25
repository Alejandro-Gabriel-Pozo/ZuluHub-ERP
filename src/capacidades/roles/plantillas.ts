import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import {
  validarConjuntoDeAcciones,
  type ContextoDeValidacion,
  type ProblemaDeConjunto,
} from "./validar-conjunto";

/**
 * VERSIONES DE PLANTILLA (H4b §3.2, I2, I5, I16): la plataforma cambia una plantilla agregando una versión nueva (nunca editando una).
 * Una versión es válida si (1) es de `ADMINISTRADOR` u `OPERADOR` (el gerente no tiene lista, I2), (2) cumple catálogo y pisos (no es de un
 * plan: una plantilla es de la plataforma) y (3) respeta el orden jerárquico: lo que puede el operador lo puede el administrador (I16;
 * el gerente tiene todo). Vale para plantillas, no para roles propios. Puro.
 *
 * Previene: una plantilla donde el operador puede lo que el administrador no, o que lleva una acción reservada al gerente; y una
 * edición del gerente, que no es editable. Chequeo: `plantillas.test.ts` y `plantillas.propiedades.test.ts`.
 */
export type ClaveDePlantillaEditable = "ADMINISTRADOR" | "OPERADOR";

export type ProblemaDeVersion =
  ProblemaDeConjunto | Readonly<{ accion: string; motivo: "ROMPE_EL_ORDEN_JERARQUICO" }>;

export type VersionPropuesta = Readonly<{
  clave: ClaveDePlantillaEditable;
  acciones: readonly string[];
  /** La otra plantilla, en su versión vigente (con la que se compara el orden). */
  otraVigente: readonly string[];
}>;

/** Sin plan: el contexto de una plantilla no lleva `modulosDelPlan`. */
export type ContextoDePlantilla = Omit<ContextoDeValidacion, "modulosDelPlan">;

export function validarVersionDePlantilla(
  propuesta: VersionPropuesta,
  contexto: ContextoDePlantilla,
): Resultado<readonly string[], readonly ProblemaDeVersion[]> {
  const conjunto = validarConjuntoDeAcciones(propuesta.acciones, {
    ...contexto,
    modulosDelPlan: null,
  });
  const problemas: ProblemaDeVersion[] = conjunto.ok ? [] : [...conjunto.error];
  const propias = new Set(propuesta.acciones);
  const otras = new Set(propuesta.otraVigente);
  const operador = propuesta.clave === "OPERADOR" ? propias : otras;
  const administrador = propuesta.clave === "ADMINISTRADOR" ? propias : otras;
  for (const accion of [...operador].sort()) {
    if (!administrador.has(accion)) problemas.push({ accion, motivo: "ROMPE_EL_ORDEN_JERARQUICO" });
  }
  return problemas.length === 0 && conjunto.ok ? ok(conjunto.valor) : err(problemas);
}

/** El número de la versión que sigue (las versiones no tienen saltos: empiezan en 1). */
export function numeroDeLaProximaVersion(vigente: number | null): number {
  return (vigente ?? 0) + 1;
}
