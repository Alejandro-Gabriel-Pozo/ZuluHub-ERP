/** Entrada pública del módulo de identidad (ADR-001): dominio, persistencia y casos de uso. */
export { emailDesdeTexto, type Email } from "../../primitivas/contacto/email";
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
  ErrorDeRevocacion,
  ErrorDeSucursalesDeInvitacion,
  RolDistintoAlAnterior,
} from "./dominio/errores";
export {
  PLAZOS_EN_MS,
  TRANSICIONES_DE_INVITACION,
  decidirAceptacion,
  decidirInvitacionDeUsuario,
  decidirReenvio,
  decidirReenvioDeAlta,
  decidirRevocacion,
  decidirSucursalesDeInvitacion,
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
  type DecisionDeRevocacion,
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
export { crearConsultasDeIdentidad, type ConsultasDeIdentidad } from "./consultas/consultas";
export type {
  DependenciasDeConsultasDeIdentidad,
  TxDeConsultasDeIdentidad,
} from "./consultas/contrato";
export type { ErrorAlListarMiembros, MiembroDeLista } from "./consultas/listar-miembros";
export type {
  ErrorAlListarInvitacionesPendientes,
  InvitacionPendienteDeLaLista,
} from "./consultas/listar-invitaciones-pendientes";
export type {
  ErrorAlConsultarTraspasoEnCurso,
  PersonaDelTraspaso,
  TraspasoEnCursoDeLaPantalla,
} from "./consultas/traspaso-en-curso";
export { DECLARACIONES as DECLARACIONES_DE_IDENTIDAD } from "./casos-de-uso/declaraciones";
export type { DeclaracionDeCaso } from "./casos-de-uso/declaraciones";
export {
  TRABAJO_AVISAR_TRASPASO_ACEPTADO,
  TRABAJO_AVISAR_TRASPASO_PROPUESTO,
  TRABAJO_AVISAR_TRASPASO_RECHAZADO,
  TRABAJO_ENVIAR_INVITACION,
  claveDeAvisoDeTraspaso,
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
  EntradaDeAceptarTraspaso,
  ErrorAlAceptarTraspaso,
  SalidaDeAceptarTraspaso,
} from "./casos-de-uso/aceptar-traspaso";
export type {
  EntradaDeAsignarSucursales,
  ErrorAlAsignarSucursales,
  SalidaDeAsignarSucursales,
} from "./casos-de-uso/asignar-sucursales";
export type {
  EntradaDeCancelarTraspaso,
  ErrorAlCancelarTraspaso,
  SalidaDeCancelarTraspaso,
} from "./casos-de-uso/cancelar-traspaso";
export type {
  EntradaDeProponerTraspaso,
  ErrorAlProponerTraspaso,
  SalidaDeProponerTraspaso,
} from "./casos-de-uso/proponer-traspaso";
export type {
  EntradaDeRechazarTraspaso,
  ErrorAlRechazarTraspaso,
  SalidaDeRechazarTraspaso,
} from "./casos-de-uso/rechazar-traspaso";
export type {
  EntradaDeRevocarInvitacion,
  ErrorAlRevocarInvitacion,
  SalidaDeRevocarInvitacion,
} from "./casos-de-uso/revocar-invitacion";
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
  crearRepositorioDeTraspasos,
  type Asignacion,
  type InvitacionPendienteDeLista,
  type MiembroConEmail,
  type RepositorioDeAsignaciones,
  type RepositorioDeInvitaciones,
  type RepositorioDeMembresias,
  type RepositorioDePersonas,
  type RepositorioDeTraspasos,
  type TraspasoGuardado,
} from "./persistencia/repositorios";
export type { IdentidadDb } from "./persistencia/tablas";
