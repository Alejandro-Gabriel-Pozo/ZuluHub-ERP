/** Entrada pública del módulo de identidad (ADR-001): dominio, persistencia y casos de uso. */
export { emailDesdeTexto, type Email } from "./dominio/email";
export type { EmpresaNoOpera, EstadosDeEmpresa } from "../../contexto/estados";
export type {
  ErrorDeAceptacion,
  ErrorDeInvitacion,
  ErrorDeMembresia,
  RolDistintoAlAnterior,
} from "./dominio/errores";
export {
  PLAZOS_EN_MS,
  TRANSICIONES_DE_INVITACION,
  decidirAceptacion,
  decidirInvitacionDeUsuario,
  decidirReenvio,
  estadoDeInvitacion,
  nuevaInvitacion,
  type DatosDeAceptacion,
  type DatosDeInvitacionDeUsuario,
  type DatosDeNuevaInvitacion,
  type DatosDeReenvio,
  type DecisionDeAceptacion,
  type DecisionDeInvitacionDeUsuario,
  type DecisionDeReenvio,
  type EmpresaInvitada,
  type EstadoDeInvitacion,
  type EstadoGuardado,
  type Invitacion,
  type NuevaInvitacion,
  type RolDeEmpresa,
  type TipoDeInvitacion,
} from "./dominio/invitacion";
export { decidirApagado, type Membresia, type Persona } from "./dominio/membresia";
export {
  crearCasosDeUsoDeIdentidad,
  type CasosDeUsoDeIdentidad,
} from "./casos-de-uso/casos-de-uso";
export type {
  EntradaDeAceptacion,
  ErrorAlAceptarInvitacion,
  SalidaDeAceptacion,
} from "./casos-de-uso/aceptar-invitacion";
export type {
  EntradaDeApagarMembresia,
  ErrorAlApagarMembresia,
  SalidaDeApagarMembresia,
} from "./casos-de-uso/apagar-membresia";
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_IDENTIDAD } from "./consultas/declaraciones";
export { DECLARACIONES as DECLARACIONES_DE_IDENTIDAD } from "./casos-de-uso/declaraciones";
export type { DeclaracionDeCaso } from "./casos-de-uso/declaraciones";
export {
  TRABAJO_ENVIAR_INVITACION,
  claveDeEnvioDeInvitacion,
  type DependenciasDeIdentidad,
  type TxDeIdentidad,
} from "./casos-de-uso/contrato";
export type {
  EntradaDeInvitarUsuario,
  ErrorAlInvitarUsuario,
  SalidaDeInvitarUsuario,
} from "./casos-de-uso/invitar-usuario";
export type {
  EntradaDeReenviarInvitacion,
  ErrorAlReenviarInvitacion,
  SalidaDeReenviarInvitacion,
} from "./casos-de-uso/reenviar-invitacion";
export {
  COLUMNAS_DE_IDENTIDAD,
  ERRORES_DE_IDENTIDAD_POR_RESTRICCION,
} from "./persistencia/esquema";
export {
  crearRepositorioDeAsignaciones,
  crearRepositorioDeInvitaciones,
  crearRepositorioDeMembresias,
  crearRepositorioDePersonas,
  type Asignacion,
  type RepositorioDeAsignaciones,
  type RepositorioDeInvitaciones,
  type RepositorioDeMembresias,
  type RepositorioDePersonas,
} from "./persistencia/repositorios";
export type { IdentidadDb } from "./persistencia/tablas";
