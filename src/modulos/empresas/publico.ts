/** Entrada pública del módulo de empresas (ADR-001). */
export {
  TRANSICIONES_DE_EMPRESA,
  cambiarEstado,
  razonSocialValida,
  type CambioDeEstadoDeEmpresa,
  type Empresa,
  type ErrorDeEmpresa,
} from "./dominio/empresa";
export { DECLARACIONES as DECLARACIONES_DE_EMPRESAS } from "./casos-de-uso/declaraciones";
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_EMPRESAS } from "./consultas/declaraciones";
export { nombreDeSucursalValido, type ErrorDeSucursal, type Sucursal } from "./dominio/sucursal";
export {
  COLUMNAS_DE_EMPRESAS,
  ERRORES_DE_EMPRESAS_POR_RESTRICCION,
  crearRepositorioDeEmpresas,
  crearRepositorioDeSucursales,
  type EmpresasDb,
  type ErrorDeRepositorioDeEmpresas,
  type NuevaEmpresa,
  type RepositorioDeEmpresas,
  type RepositorioDeSucursales,
} from "./persistencia/repositorios";
