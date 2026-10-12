import type { ClaveAccionDePlataforma } from "../../capacidades/permisos/plataforma";

/** Qué acción del catálogo de plataforma exige un caso de uso o una consulta (cruce X1 de ADR-003). */
export type DeclaracionDeAccionDePlataforma = Readonly<{ accion: ClaveAccionDePlataforma }>;

/**
 * Las consultas de soporte de plataforma (H5 §B.5.7 y §B.5.9) y la acción que cada una exige al guard.
 * Una acción que no existe en el catálogo de plataforma, o una declaración vacía, no compila; y la
 * fábrica de `consultas.ts` exige que cada consulta tenga la suya.
 */
export const DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA = {
  listarTenants: { accion: "tenants.ver" },
  listarEmpresas: { accion: "empresas.ver" },
  listarAltasPendientes: { accion: "empresas.ver" },
  listarInvitaciones: { accion: "invitaciones.ver" },
  listarTrabajosFallidos: { accion: "trabajos.ver_fallidos" },
  consultarAuditoria: { accion: "auditoria.ver" },
  verConfiguracion: { accion: "configuracion.ver" },
  buscarReferencia: { accion: "soporte.buscar_referencia" },
} as const satisfies Record<string, DeclaracionDeAccionDePlataforma>;
