import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import {
  DECLARACION_DE_ALTA_DE_EMPRESA,
  armarAltaDeEmpresa,
  type DependenciasDeAltaDeEmpresa,
} from "./alta-de-empresa";
import {
  DECLARACION_DE_CANCELAR_ALTA,
  armarCancelarAlta,
  type TxDeCancelacionDeAlta,
} from "./cancelar-alta";
import {
  DECLARACION_DEL_BARRIDO_DE_ALTAS,
  armarCancelarAltasVencidas,
  type DependenciasDelBarrido,
} from "./cancelar-altas-vencidas";
import type { DependenciasDeCasoDePlataforma } from "./caso-de-plataforma";
import {
  DECLARACION_DE_REENVIAR_INVITACION_DEL_ALTA,
  DECLARACION_DE_REVOCAR_INVITACION_DEL_ALTA,
  armarReenviarInvitacionDelAlta,
  armarRevocarInvitacionDelAlta,
  type DependenciasDeReenvioDelAlta,
  type TxDeRevocacionDelAlta,
} from "./invitacion-del-alta";

/**
 * Los casos de uso del alta de empresas de plataforma (H5 §B.5.1, §B.5.3, §B.5.4 y marcas y planes §B.10) y qué
 * exige cada uno al guard (cruce X1 de ADR-003). El barrido de altas vencidas no pasa por el guard: lo corre
 * el sistema, y lo declara con su motivo.
 */
export const DECLARACIONES_DE_ALTAS = {
  altaDeEmpresa: DECLARACION_DE_ALTA_DE_EMPRESA,
  cancelarAlta: DECLARACION_DE_CANCELAR_ALTA,
  cancelarAltasVencidas: DECLARACION_DEL_BARRIDO_DE_ALTAS,
  reenviarInvitacionDelAlta: DECLARACION_DE_REENVIAR_INVITACION_DEL_ALTA,
  revocarInvitacionDelAlta: DECLARACION_DE_REVOCAR_INVITACION_DEL_ALTA,
} as const satisfies Record<
  string,
  DeclaracionDeAccionDePlataforma | Readonly<{ sinGuard: string }>
>;

export type DependenciasDeAltas = Readonly<{
  altaDeEmpresa: DependenciasDeAltaDeEmpresa;
  cancelarAlta: DependenciasDeCasoDePlataforma<TxDeCancelacionDeAlta>;
  cancelarAltasVencidas: DependenciasDelBarrido;
  reenviarInvitacionDelAlta: DependenciasDeReenvioDelAlta;
  revocarInvitacionDelAlta: DependenciasDeCasoDePlataforma<TxDeRevocacionDelAlta>;
}>;

/**
 * El `satisfies` exige que sean EXACTAMENTE los que declara `DECLARACIONES_DE_ALTAS`: un caso de uso
 * nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeAltas(dependencias: DependenciasDeAltas) {
  return {
    altaDeEmpresa: armarAltaDeEmpresa(dependencias.altaDeEmpresa),
    cancelarAlta: armarCancelarAlta(dependencias.cancelarAlta),
    cancelarAltasVencidas: armarCancelarAltasVencidas(dependencias.cancelarAltasVencidas),
    reenviarInvitacionDelAlta: armarReenviarInvitacionDelAlta(
      dependencias.reenviarInvitacionDelAlta,
    ),
    revocarInvitacionDelAlta: armarRevocarInvitacionDelAlta(dependencias.revocarInvitacionDelAlta),
  } satisfies Record<keyof typeof DECLARACIONES_DE_ALTAS, unknown>;
}

export type CasosDeUsoDeAltas = ReturnType<typeof crearCasosDeUsoDeAltas>;
