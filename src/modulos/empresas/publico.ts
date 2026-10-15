/** Entrada pública del módulo de empresas (ADR-001). */
export {
  TRANSICIONES_DE_EMPRESA,
  cambiarEstado,
  razonSocialValida,
  type CambioDeEstadoDeEmpresa,
  type Empresa,
  type ErrorDeEmpresa,
} from "./dominio/empresa";
export { datosDeJornada } from "./datos-de-jornada";
export { DECLARACIONES as DECLARACIONES_DE_EMPRESAS } from "./casos-de-uso/declaraciones";
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_EMPRESAS } from "./consultas/declaraciones";
export {
  LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL,
  decidirAltaConNombreOcupado,
  decidirDesactivacion,
  decidirEdicion,
  decidirReactivacion,
  horaDeCorteValida,
  nombreDeSucursalValido,
  type DatosDeJornada,
  type DecisionDeAlta,
  type DecisionDeDesactivacion,
  type DecisionDeEdicion,
  type DecisionDeReactivacion,
  type ErrorDeHoraDeCorte,
  type ErrorDeNombreDeSucursal,
  type ErrorDeSucursal,
  type Sucursal,
} from "./dominio/sucursal";
export { crearCasosDeUsoDeEmpresas, type CasosDeUsoDeEmpresas } from "./casos-de-uso/casos-de-uso";
export type { DependenciasDeEmpresas, TxDeEmpresas } from "./casos-de-uso/contrato";
export type {
  EntradaDeCrearSucursal,
  ErrorAlCrearSucursal,
  SalidaDeCrearSucursal,
} from "./casos-de-uso/crear-sucursal";
export type {
  EntradaDeEditarSucursal,
  ErrorAlEditarSucursal,
  SalidaDeEditarSucursal,
} from "./casos-de-uso/editar-sucursal";
export type {
  EntradaDeDesactivarSucursal,
  ErrorAlDesactivarSucursal,
  SalidaDeDesactivarSucursal,
} from "./casos-de-uso/desactivar-sucursal";
export type {
  EntradaDeReactivarSucursal,
  ErrorAlReactivarSucursal,
  SalidaDeReactivarSucursal,
} from "./casos-de-uso/reactivar-sucursal";
export { crearConsultasDeEmpresas, type ConsultasDeEmpresas } from "./consultas/consultas";
export type {
  DependenciasDeConsultasDeEmpresas,
  TxDeConsultasDeEmpresas,
} from "./consultas/contrato";
export type {
  EntradaDeListarSucursales,
  ErrorAlListarSucursales,
} from "./consultas/listar-sucursales";
export type {
  EntradaDeFichaDeSucursal,
  ErrorAlPedirLaFichaDeSucursal,
} from "./consultas/ficha-de-sucursal";
export type { FichaDeSucursal, SucursalDeLista } from "./consultas/sucursales";
export {
  COLUMNAS_DE_EMPRESAS,
  ERRORES_DE_EMPRESAS_POR_RESTRICCION,
  crearRepositorioDeEmpresas,
  crearRepositorioDeSucursales,
  type AltaDeSucursal,
  type AltaVencida,
  type EmpresaConCreadoEn,
  type EmpresasDb,
  type ErrorDeRepositorioDeEmpresas,
  type NuevaEmpresa,
  type RepositorioDeEmpresas,
  type RepositorioDeSucursales,
} from "./persistencia/repositorios";
