import type { ClaveAccionDeGrupo } from "../capacidades/permisos/grupo";

/**
 * Las consultas de grupo (H6, especificación §B.5) y la acción que cada una exige al guard (cruce X1 de
 * ADR-003). La acción es del catálogo de GRUPO, no del de empresa: una que no existe ahí no compila.
 */
export const DECLARACIONES_DE_CONSULTAS_DE_GRUPO = {
  listarEmpresasDelGrupo: { accion: "grupo.ver_empresas" },
} as const satisfies Record<string, Readonly<{ accion: ClaveAccionDeGrupo }>>;
