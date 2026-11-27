import type { DependenciasDeConsultasDeIdentidad } from "./contrato";
import type { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { armarAccionesParaElegir } from "./acciones-para-elegir";
import { armarListarInvitacionesPendientes } from "./listar-invitaciones-pendientes";
import { armarListarMiembros } from "./listar-miembros";
import { armarListarRoles } from "./listar-roles";
import { armarPersonasParaMostrar } from "./personas-para-mostrar";
import { armarTraspasoEnCurso } from "./traspaso-en-curso";
import { armarRolesAsignables } from "./roles-asignables";
import { armarVerRol } from "./ver-rol";

/**
 * Las consultas por pantalla de identidad (ADR-005). El `satisfies` exige que cada una tenga su
 * declaración (qué acción exige): una consulta sin declarar, o con una acción que no existe en el
 * catálogo, no compila. `traspasoEnCurso` la suma el tramo T4 de H6, y entonces este `Partial`
 * pasa a ser un `Record`.
 */
export function crearConsultasDeIdentidad(dependencias: DependenciasDeConsultasDeIdentidad) {
  return {
    listarMiembros: armarListarMiembros(dependencias),
    listarInvitacionesPendientes: armarListarInvitacionesPendientes(dependencias),
    traspasoEnCurso: armarTraspasoEnCurso(dependencias),
    personasParaMostrar: armarPersonasParaMostrar(dependencias),
    listarRoles: armarListarRoles(dependencias),
    verRol: armarVerRol(dependencias),
    rolesAsignables: armarRolesAsignables(dependencias),
    accionesParaElegir: armarAccionesParaElegir(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_CONSULTAS, unknown>;
}

export type ConsultasDeIdentidad = ReturnType<typeof crearConsultasDeIdentidad>;
