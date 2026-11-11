/**
 * Entrada pública del módulo de clientes y proveedores (ADR-001; E9): los demás módulos (compras, la composición) solo importan de acá. Trae los casos de
 * uso y las consultas con sus declaraciones (X1), los puertos que ofrece a compras y a facturación (`puertos.ts`) y la persistencia que la composición
 * arma sobre la conexión de cada transacción.
 */
export { DECLARACIONES as DECLARACIONES_DE_CLIENTES } from "./casos-de-uso/declaraciones";
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_CLIENTES } from "./consultas/declaraciones";
export { crearCasosDeUsoDeClientes, type CasosDeUsoDeClientes } from "./casos-de-uso/casos-de-uso";
export { crearConsultasDeClientes, type ConsultasDeClientes } from "./consultas/consultas";
export type {
  DependenciasDeClientes,
  DependenciasDeConsultasDeClientes,
  TxDeClientes,
  TxDeConsultasDeClientes,
} from "./casos-de-uso/contrato";
export type { ErrorDeClientes } from "./casos-de-uso/errores";
export type {
  EntradaDeCambiarEstadoDeParte,
  EntradaDeCrearParte,
  EntradaDeEditarParte,
  PosibleDuplicado,
  SalidaDeCambiarEstadoDeParte,
  SalidaDeCrearParte,
  SalidaDeEditarParte,
} from "./casos-de-uso/partes";
export type {
  EntradaDeCambiarRolesDeParte,
  EntradaDeDesvincularContacto,
  EntradaDeVincularContacto,
  SalidaDeCambiarRolesDeParte,
  SalidaDeDesvincularContacto,
  SalidaDeVincularContacto,
} from "./casos-de-uso/roles-y-vinculos";
export type {
  EntradaDeBuscarPartes,
  EntradaDePosiblesDuplicados,
  FichaDeParte,
  PaginaDePartes,
  ParteDeLista,
} from "./consultas/partes";
export {
  crearDirectorioDePartes,
  crearRegistroDePartes,
  type DirectorioDePartes,
  type EntradaDeCompletarDocumento,
  type ErrorDeCompletarDocumento,
  type ErrorDeParteParaOperacion,
  type ParteParaOperacion,
  type RegistroDePartes,
  type SalidaDeCompletarDocumento,
} from "./puertos";
export {
  datosDeReceptorSugeridos,
  type DatosParaReceptor,
  type ReceptorSugerido,
} from "./dominio/receptor-sugerido";
export { ROLES_DE_PARTE, type RolDeParte } from "./dominio/roles";
export {
  crearRepositoriosDeClientes,
  type RepositoriosDeClientes,
} from "./persistencia/repositorios-de-clientes";
export { ERRORES_DE_CLIENTES_POR_RESTRICCION } from "./persistencia/errores-por-restriccion";
