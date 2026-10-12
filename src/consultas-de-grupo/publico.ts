/** Entrada pública de las consultas de grupo (ADR-001): la vista de solo lectura del propietario. */
export { DECLARACIONES_DE_CONSULTAS_DE_GRUPO } from "./declaraciones";
export { crearConsultasDeGrupo, type ConsultasDeGrupo } from "./consultas";
export type { DependenciasDeConsultasDeGrupo, TxDeConsultasDeGrupo } from "./contrato";
export type { ErrorAlListarEmpresasDelGrupo } from "./listar-empresas-del-grupo";
export type { EmpresaDeGrupo, VistaDeGrupo } from "./vista-de-grupo";
