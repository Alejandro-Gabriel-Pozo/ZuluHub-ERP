import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import { DECLARACION_DE_AGREGAR_DOMINIO, armarAgregarDominio } from "./agregar-dominio";
import {
  DECLARACION_DE_ACTIVAR_DOMINIO,
  DECLARACION_DE_DESACTIVAR_DOMINIO,
  DECLARACION_DE_RETIRAR_DOMINIO,
  DECLARACION_DE_VERIFICAR_DOMINIO,
  armarActivarDominio,
  armarDesactivarDominio,
  armarRetirarDominio,
  armarVerificarDominio,
} from "./cambiar-estado-de-dominio";
import type { DependenciasDeDominios } from "./dominios-comun";

/**
 * Los casos de uso de gestión de dominios de plataforma (M4a, marcas y planes §B.11) y qué exige cada uno al
 * guard (cruce X1 de ADR-003). Todos pasan por el guard: ninguno es `sinGuard`.
 */
export const DECLARACIONES_DE_DOMINIOS = {
  agregarDominio: DECLARACION_DE_AGREGAR_DOMINIO,
  verificarDominio: DECLARACION_DE_VERIFICAR_DOMINIO,
  activarDominio: DECLARACION_DE_ACTIVAR_DOMINIO,
  desactivarDominio: DECLARACION_DE_DESACTIVAR_DOMINIO,
  retirarDominio: DECLARACION_DE_RETIRAR_DOMINIO,
} as const satisfies Record<string, DeclaracionDeAccionDePlataforma>;

/**
 * El `satisfies` exige que sean EXACTAMENTE los que declara `DECLARACIONES_DE_DOMINIOS`: un caso de uso
 * nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeDominios(dependencias: DependenciasDeDominios) {
  return {
    agregarDominio: armarAgregarDominio(dependencias),
    verificarDominio: armarVerificarDominio(dependencias),
    activarDominio: armarActivarDominio(dependencias),
    desactivarDominio: armarDesactivarDominio(dependencias),
    retirarDominio: armarRetirarDominio(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_DOMINIOS, unknown>;
}

export type CasosDeUsoDeDominios = ReturnType<typeof crearCasosDeUsoDeDominios>;
