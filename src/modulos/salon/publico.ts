/**
 * Entrada pública del módulo de salón (ADR-001; E7): los demás módulos solo importan de acá.
 */
export { DECLARACIONES as DECLARACIONES_DE_SALON } from "./casos-de-uso/declaraciones";
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_SALON } from "./consultas/declaraciones";
export { crearCasosDeUsoDeSalon, type CasosDeUsoDeSalon } from "./casos-de-uso/casos-de-uso";
export { crearConsultasDeSalon, type ConsultasDeSalon } from "./consultas/consultas";
export type { DependenciasDeSalon, TxDeSalon } from "./casos-de-uso/contrato";
export type { DependenciasDeConsultasDeSalon, TxDeConsultasDeSalon } from "./consultas/contrato";
export type { ErrorDeSalon } from "./casos-de-uso/errores";
export type {
  EntradaDeCrearMesa,
  EntradaDeEditarMesa,
  EntradaDeMesaPorId,
  SalidaDeMesa,
} from "./casos-de-uso/mesas";
export { COLUMNAS_DE_SALON, type SalonDb } from "./persistencia/esquema";
export { ERRORES_DE_SALON_POR_RESTRICCION } from "./persistencia/restricciones";
export {
  crearRepositoriosDeSalon,
  type RepositoriosDeSalon,
} from "./persistencia/repositorios-de-salon";
export type { Mesa } from "./persistencia/repositorio-de-mesas";
