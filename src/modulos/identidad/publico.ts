/** Entrada pública del módulo de identidad (ADR-001). Por ahora solo el dominio. */
export { emailDesdeTexto, type Email } from "./dominio/email";
export type {
  EmpresaNoOpera,
  ErrorDeAceptacion,
  ErrorDeInvitacion,
  ErrorDeMembresia,
} from "./dominio/errores";
export {
  PLAZOS_EN_MS,
  TRANSICIONES_DE_INVITACION,
  decidirAceptacion,
  decidirReenvio,
  estadoDeInvitacion,
  nuevaInvitacion,
  type DatosDeAceptacion,
  type DatosDeNuevaInvitacion,
  type DatosDeReenvio,
  type DecisionDeAceptacion,
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
export { decidirApagado, type Membresia, type Persona } from "./dominio/membresia";
