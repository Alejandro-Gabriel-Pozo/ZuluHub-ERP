/** Entrada pública del módulo de identidad (ADR-001): dominio, persistencia y casos de uso. */
export { emailDesdeTexto, type Email } from "./dominio/email";
export type {
  EmpresaNoOpera,
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
  type EstadosDeEmpresa,
  type Invitacion,
  type NuevaInvitacion,
  type RolDeEmpresa,
  type TipoDeInvitacion,
} from "./dominio/invitacion";
export {
  decidirApagado,
  puedeAdministrarAccesos,
  type Membresia,
  type Persona,
} from "./dominio/membresia";
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
