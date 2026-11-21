import type { DependenciasDePortal } from "./contrato";
import type { DECLARACIONES } from "./declaraciones";
import { armarGuardarPortalDeLaVidriera } from "./guardar-portal-de-la-vidriera";

/**
 * Los casos de uso del portal de la vidriera, listos para que la composición los ofrezca. El `satisfies` exige que sean EXACTAMENTE los que declara `DECLARACIONES`: uno
 * nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDePortal(dependencias: DependenciasDePortal) {
  return {
    guardarPortalDeLaVidriera: armarGuardarPortalDeLaVidriera(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDePortal = ReturnType<typeof crearCasosDeUsoDePortal>;
