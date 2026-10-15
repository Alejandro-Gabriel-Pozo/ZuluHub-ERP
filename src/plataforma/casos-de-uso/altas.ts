import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import {
  DECLARACION_DE_ALTA_DE_EMPRESA,
  armarAltaDeEmpresa,
  type DependenciasDeAltaDeEmpresa,
} from "./alta-de-empresa";

/**
 * Los casos de uso del alta de empresas de plataforma (H5 §B.5.1 y marcas y planes §B.10) y qué exige cada
 * uno al guard (cruce X1 de ADR-003). Todos pasan por el guard: ninguno es `sinGuard`.
 */
export const DECLARACIONES_DE_ALTAS = {
  altaDeEmpresa: DECLARACION_DE_ALTA_DE_EMPRESA,
} as const satisfies Record<string, DeclaracionDeAccionDePlataforma>;

export type DependenciasDeAltas = Readonly<{
  altaDeEmpresa: DependenciasDeAltaDeEmpresa;
}>;

/**
 * El `satisfies` exige que sean EXACTAMENTE los que declara `DECLARACIONES_DE_ALTAS`: un caso de uso
 * nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeAltas(dependencias: DependenciasDeAltas) {
  return {
    altaDeEmpresa: armarAltaDeEmpresa(dependencias.altaDeEmpresa),
  } satisfies Record<keyof typeof DECLARACIONES_DE_ALTAS, unknown>;
}

export type CasosDeUsoDeAltas = ReturnType<typeof crearCasosDeUsoDeAltas>;
