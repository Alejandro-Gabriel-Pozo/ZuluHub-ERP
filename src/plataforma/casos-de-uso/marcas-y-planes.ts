import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import { DECLARACION_DE_AJUSTAR_PERILLA, armarAjustarPerilla } from "./ajustar-perilla";
import { DECLARACION_DE_ASIGNAR_PLAN, armarAsignarPlan } from "./asignar-plan";
import {
  DECLARACION_DE_CONFIRMAR_VERSION_DE_MARCA,
  armarConfirmarVersionDeMarca,
} from "./confirmar-version-de-marca";
import { DECLARACION_DE_CREAR_MARCA, armarCrearMarca } from "./crear-marca";
import { DECLARACION_DE_CREAR_PLAN, armarCrearPlan } from "./crear-plan";
import {
  DECLARACION_DE_GUARDAR_BORRADOR_DE_MARCA,
  armarGuardarBorradorDeMarca,
} from "./guardar-borrador-de-marca";
import {
  DECLARACION_DE_GUARDAR_BORRADOR_DE_PLAN,
  armarGuardarBorradorDePlan,
} from "./guardar-borrador-de-plan";
import type { DependenciasDeMarcasYPlanes } from "./marcas-y-planes-comun";
import {
  DECLARACION_DE_MIGRAR_TENANTS_DE_VERSION,
  armarMigrarTenantsDeVersion,
} from "./migrar-tenants-de-version";
import {
  DECLARACION_DE_ACTIVAR_MODULO_DE_EMPRESA,
  DECLARACION_DE_DESACTIVAR_MODULO_DE_EMPRESA,
  armarActivarModuloDeEmpresa,
  armarDesactivarModuloDeEmpresa,
} from "./modulos-de-empresa";
import {
  DECLARACION_DE_PUBLICAR_VERSION_DE_PLAN,
  armarPublicarVersionDePlan,
} from "./publicar-version-de-plan";

/**
 * Los casos de uso de plataforma sobre marcas, planes, ajustes de perilla y módulos de empresa (M5,
 * marcas y planes §B.11) y qué exige cada uno al guard (cruce X1 de ADR-003). Todos pasan por el guard:
 * ninguno es `sinGuard`. (Los dominios están en `dominios.ts`, M4a.)
 */
export const DECLARACIONES_DE_MARCAS_Y_PLANES = {
  crearMarca: DECLARACION_DE_CREAR_MARCA,
  guardarBorradorDeMarca: DECLARACION_DE_GUARDAR_BORRADOR_DE_MARCA,
  confirmarVersionDeMarca: DECLARACION_DE_CONFIRMAR_VERSION_DE_MARCA,
  crearPlan: DECLARACION_DE_CREAR_PLAN,
  guardarBorradorDePlan: DECLARACION_DE_GUARDAR_BORRADOR_DE_PLAN,
  publicarVersionDePlan: DECLARACION_DE_PUBLICAR_VERSION_DE_PLAN,
  asignarPlan: DECLARACION_DE_ASIGNAR_PLAN,
  migrarTenantsDeVersion: DECLARACION_DE_MIGRAR_TENANTS_DE_VERSION,
  ajustarPerilla: DECLARACION_DE_AJUSTAR_PERILLA,
  activarModuloDeEmpresa: DECLARACION_DE_ACTIVAR_MODULO_DE_EMPRESA,
  desactivarModuloDeEmpresa: DECLARACION_DE_DESACTIVAR_MODULO_DE_EMPRESA,
} as const satisfies Record<string, DeclaracionDeAccionDePlataforma>;

/**
 * El `satisfies` exige que sean EXACTAMENTE los que declara `DECLARACIONES_DE_MARCAS_Y_PLANES`: un caso de
 * uso nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeMarcasYPlanes(dependencias: DependenciasDeMarcasYPlanes) {
  return {
    crearMarca: armarCrearMarca(dependencias),
    guardarBorradorDeMarca: armarGuardarBorradorDeMarca(dependencias),
    confirmarVersionDeMarca: armarConfirmarVersionDeMarca(dependencias),
    crearPlan: armarCrearPlan(dependencias),
    guardarBorradorDePlan: armarGuardarBorradorDePlan(dependencias),
    publicarVersionDePlan: armarPublicarVersionDePlan(dependencias),
    asignarPlan: armarAsignarPlan(dependencias),
    migrarTenantsDeVersion: armarMigrarTenantsDeVersion(dependencias),
    ajustarPerilla: armarAjustarPerilla(dependencias),
    activarModuloDeEmpresa: armarActivarModuloDeEmpresa(dependencias),
    desactivarModuloDeEmpresa: armarDesactivarModuloDeEmpresa(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_MARCAS_Y_PLANES, unknown>;
}

export type CasosDeUsoDeMarcasYPlanes = ReturnType<typeof crearCasosDeUsoDeMarcasYPlanes>;
