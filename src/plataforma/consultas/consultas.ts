import { armarConsultarAuditoria } from "./auditoria";
import { armarBuscarReferencia } from "./buscar-referencia";
import { armarCatalogoDePerillas, armarVerConfiguracion } from "./configuracion";
import type { DependenciasDeConsultasDePlataforma } from "./contrato";
import type { DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA } from "./declaraciones";
import { armarListarInvitaciones } from "./invitaciones";
import { armarListarTrabajosFallidos } from "./trabajos-fallidos";
import {
  armarListarAltasPendientes,
  armarListarEmpresas,
  armarListarTenants,
} from "./tenants-y-empresas";

/**
 * Las consultas de soporte de plataforma (H5 §B.5.7 y §B.5.9), listas para que la composición las
 * ofrezca. El `satisfies` exige que sean EXACTAMENTE las que declara
 * `DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA` (qué acción exige cada una): una consulta sin declarar, o
 * una declaración sin consulta, no compila.
 */
export function crearConsultasDePlataforma(dependencias: DependenciasDeConsultasDePlataforma) {
  return {
    listarTenants: armarListarTenants(dependencias),
    listarEmpresas: armarListarEmpresas(dependencias),
    listarAltasPendientes: armarListarAltasPendientes(dependencias),
    listarInvitaciones: armarListarInvitaciones(dependencias),
    listarTrabajosFallidos: armarListarTrabajosFallidos(dependencias),
    consultarAuditoria: armarConsultarAuditoria(dependencias),
    verConfiguracion: armarVerConfiguracion(dependencias),
    catalogoDePerillas: armarCatalogoDePerillas(dependencias),
    buscarReferencia: armarBuscarReferencia(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA, unknown>;
}

export type ConsultasDePlataforma = ReturnType<typeof crearConsultasDePlataforma>;
