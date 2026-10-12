/** Entrada pública del módulo de identidad (ADR-001): dominio, persistencia y casos de uso. */
export { emailDesdeTexto, type Email } from "./dominio/email";
export type { EmpresaNoOpera, EstadosDeEmpresa } from "../../contexto/estados";
export type {
  ErrorDeAceptacion,
  ErrorDeAceptacionDeTraspaso,
  ErrorDeAsignaciones,
  ErrorDeCancelacionDeTraspaso,
  ErrorDeInvitacion,
  ErrorDeMembresia,
  ErrorDePropuestaDeTraspaso,
  ErrorDeRechazoDeTraspaso,
  ErrorDeReenvioDeAlta,
  RolDistintoAlAnterior,
} from "./dominio/errores";
export {
  PLAZOS_EN_MS,
  TRANSICIONES_DE_INVITACION,
  decidirAceptacion,
  decidirInvitacionDeUsuario,
  decidirReenvio,
  decidirReenvioDeAlta,
  estadoDeInvitacion,
  nuevaInvitacion,
  type DatosDeAceptacion,
  type DatosDeInvitacionDeUsuario,
  type DatosDeNuevaInvitacion,
  type DatosDeReenvio,
  type DatosDeReenvioDeAlta,
  type DecisionDeAceptacion,
  type DecisionDeInvitacionDeUsuario,
  type DecisionDeReenvio,
  type DecisionDeReenvioDeAlta,
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
  decidirAsignaciones,
  type AsignacionActual,
  type CambioDeAsignaciones,
  type SucursalDeLaEmpresa,
} from "./dominio/asignacion";
export {
  PLAZO_DEL_TRASPASO_EN_MS,
  TRANSICIONES_DE_TRASPASO,
  decidirAceptacionDeTraspaso,
  decidirCancelacion,
  decidirPropuesta,
  decidirRechazo,
  estadoDeTraspaso,
  vencimientoDeTraspaso,
  type DecisionDeAceptacionDeTraspaso,
  type DecisionDeCancelacion,
  type DecisionDePropuesta,
  type DecisionDeRechazo,
  type EstadoDeTraspaso,
  type EstadoGuardadoDeTraspaso,
  type OrigenDeTraspaso,
  type Traspaso,
} from "./dominio/traspaso";
export {
  armarEnlaceDeInvitacion,
  armarMensajeDeInvitacion,
  decidirEnvioDeInvitacion,
  type DatosDeEnvio,
  type DecisionDeEnvio,
  type MarcaDeMail,
  type MensajeDeInvitacion,
  type MotivoDeOmision,
} from "./dominio/envio";
export {
  crearManejadorDeEnviarInvitacion,
  type DependenciasDeEnvioDeInvitacion,
  type TxDeEnvioDeInvitacion,
} from "./casos-de-uso/enviar-invitacion";
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
