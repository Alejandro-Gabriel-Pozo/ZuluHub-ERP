import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import {
  DECLARACION_DE_EXPLICAR_POR_QUE,
  armarExplicarPorQue,
  type DependenciasDeExplicar,
} from "./explicar-por-que";
import {
  armarRegistrarReferenciaDeError,
  type DependenciasDeReferencias,
} from "./registrar-referencia";

/**
 * Los casos de uso de soporte de plataforma (H5 §B.5.9) y qué exige cada uno al guard (cruce X1 de
 * ADR-003). Registrar una referencia no pasa por el guard: lo escribe quien recibió el rechazo, con
 * su propio contexto, después de que su caso de uso se revirtió; la base le deja escribir solo lo suyo.
 */
export const DECLARACIONES_DE_SOPORTE = {
  explicarPorQue: DECLARACION_DE_EXPLICAR_POR_QUE,
  registrarReferenciaDeError: {
    sinGuard:
      "lo registra quien recibió el rechazo, con su propio contexto; la base compara la empresa y la persona con las del contexto firmado",
  },
} as const satisfies Record<
  string,
  DeclaracionDeAccionDePlataforma | Readonly<{ sinGuard: string }>
>;

export type DependenciasDeSoporte = Readonly<{
  explicar: DependenciasDeExplicar;
  referencias: DependenciasDeReferencias;
}>;

/**
 * El `satisfies` exige que sean EXACTAMENTE los que declara `DECLARACIONES_DE_SOPORTE`: un caso de uso
 * nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeSoporte({ explicar, referencias }: DependenciasDeSoporte) {
  return {
    explicarPorQue: armarExplicarPorQue(explicar),
    registrarReferenciaDeError: armarRegistrarReferenciaDeError(referencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_SOPORTE, unknown>;
}

export type CasosDeUsoDeSoporte = ReturnType<typeof crearCasosDeUsoDeSoporte>;
