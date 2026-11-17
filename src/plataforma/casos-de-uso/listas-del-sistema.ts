import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import {
  DECLARACION_DE_AGREGAR_VALOR_DE_LISTA,
  armarAgregarValorDeLista,
} from "./agregar-valor-de-lista";
import {
  DECLARACION_DE_DESACTIVAR_VALOR_DE_LISTA,
  DECLARACION_DE_REACTIVAR_VALOR_DE_LISTA,
  armarDesactivarValorDeLista,
  armarReactivarValorDeLista,
} from "./cambiar-estado-de-valor-de-lista";
import {
  DECLARACION_DE_CORREGIR_NOMBRE_DE_VALOR,
  armarCorregirNombreDeValor,
} from "./corregir-nombre-de-valor";
import type { DependenciasDeListas } from "./listas-comun";

/**
 * Los casos de uso de plataforma sobre las listas del sistema (e3 §3.7, decisión 130) y qué exige cada uno al guard (cruce X1 de
 * ADR-003). Todos pasan por el guard: ninguno es `sinGuard`. (La consulta, `listarValoresDeLista`, está en `consultas/`.)
 */
export const DECLARACIONES_DE_LISTAS = {
  agregarValorDeLista: DECLARACION_DE_AGREGAR_VALOR_DE_LISTA,
  corregirNombreDeValor: DECLARACION_DE_CORREGIR_NOMBRE_DE_VALOR,
  desactivarValorDeLista: DECLARACION_DE_DESACTIVAR_VALOR_DE_LISTA,
  reactivarValorDeLista: DECLARACION_DE_REACTIVAR_VALOR_DE_LISTA,
} as const satisfies Record<string, DeclaracionDeAccionDePlataforma>;

/**
 * El `satisfies` exige que sean EXACTAMENTE los que declara `DECLARACIONES_DE_LISTAS`: un caso de uso nuevo sin declarar, o una
 * declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeListas(dependencias: DependenciasDeListas) {
  return {
    agregarValorDeLista: armarAgregarValorDeLista(dependencias),
    corregirNombreDeValor: armarCorregirNombreDeValor(dependencias),
    desactivarValorDeLista: armarDesactivarValorDeLista(dependencias),
    reactivarValorDeLista: armarReactivarValorDeLista(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_LISTAS, unknown>;
}

export type CasosDeUsoDeListas = ReturnType<typeof crearCasosDeUsoDeListas>;
