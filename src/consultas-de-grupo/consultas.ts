import type { DependenciasDeConsultasDeGrupo } from "./contrato";
import type { DECLARACIONES_DE_CONSULTAS_DE_GRUPO } from "./declaraciones";
import { armarListarEmpresasDelGrupo } from "./listar-empresas-del-grupo";

/**
 * Las consultas de grupo, listas para que la composición las ofrezca. El `satisfies` exige que sean
 * EXACTAMENTE las que declara `DECLARACIONES_DE_CONSULTAS_DE_GRUPO` (qué acción exige cada una): una
 * consulta nueva sin declarar, o una declaración sin consulta, no compila.
 */
export function crearConsultasDeGrupo(dependencias: DependenciasDeConsultasDeGrupo) {
  return {
    listarEmpresasDelGrupo: armarListarEmpresasDelGrupo(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_CONSULTAS_DE_GRUPO, unknown>;
}

export type ConsultasDeGrupo = ReturnType<typeof crearConsultasDeGrupo>;
