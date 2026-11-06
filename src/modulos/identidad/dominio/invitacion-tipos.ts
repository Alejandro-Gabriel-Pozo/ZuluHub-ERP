import type {
  EmpresaId,
  InvitacionId,
  PersonaId,
  SucursalId,
  TenantId,
} from "../../../primitivas/identificadores/marca";
import type { Email } from "../../../primitivas/contacto/email";
import type { RolDeEmpresa } from "./membresia";

/**
 * Invitaciones (diseno-inicial §6.3). Dominio puro: sin reloj ni aleatoriedad. La hora (`ahora`),
 * los ids y el hash del token entran siempre como datos.
 */
export type TipoDeInvitacion = "ALTA_GERENTE" | "USUARIO";

/** Estados que se guardan. `VENCIDA` no se guarda: se calcula con `ahora`. */
export type EstadoGuardado = "PENDIENTE" | "ACEPTADA" | "REVOCADA";

export type EstadoDeInvitacion = EstadoGuardado | "VENCIDA";

/** Supuestos de plazo (caso 0c): 24 horas para el alta del gerente y 7 días para un usuario. */
export const PLAZOS_EN_MS: Readonly<Record<TipoDeInvitacion, number>> = {
  ALTA_GERENTE: 24 * 3_600_000,
  USUARIO: 7 * 24 * 3_600_000,
};

/**
 * Transiciones permitidas del estado guardado. La base impone la misma tabla con un disparador;
 * un test compara ambas.
 */
export const TRANSICIONES_DE_INVITACION: Readonly<
  Record<EstadoGuardado, readonly EstadoGuardado[]>
> = {
  PENDIENTE: ["ACEPTADA", "REVOCADA"],
  ACEPTADA: [],
  REVOCADA: [],
};

/** Una empresa a la que se invita, con el rol y las sucursales asignadas. */
export type EmpresaInvitada = Readonly<{
  empresaId: EmpresaId;
  rol: RolDeEmpresa;
  sucursales: readonly SucursalId[];
}>;

export type Invitacion = Readonly<{
  id: InvitacionId;
  tenantId: TenantId;
  tipo: TipoDeInvitacion;
  email: Email;
  estado: EstadoGuardado;
  emitidaEn: Date;
  venceEn: Date;
  empresas: readonly EmpresaInvitada[];
  aceptadaPor: PersonaId | null;
  reemplazadaPor: InvitacionId | null;
  version: number;
}>;

/** Invitación lista para persistir: nace siempre `PENDIENTE`; solo se conoce el hash del token. */
export type NuevaInvitacion = Readonly<{
  id: InvitacionId;
  tokenHash: string;
  tenantId: TenantId;
  tipo: TipoDeInvitacion;
  email: Email;
  emitidaPor: PersonaId | null;
  emitidaEn: Date;
  venceEn: Date;
  empresas: readonly EmpresaInvitada[];
}>;

export type DatosDeNuevaInvitacion = Readonly<{
  id: InvitacionId;
  tokenHash: string;
  tenantId: TenantId;
  tipo: TipoDeInvitacion;
  email: Email;
  empresas: readonly EmpresaInvitada[];
  emitidaPor: PersonaId | null;
}>;

/** Una invitación pendiente cuyo vencimiento llegó (`ahora >= venceEn`) pasa a `VENCIDA`. */
export function estadoDeInvitacion(invitacion: Invitacion, ahora: Date): EstadoDeInvitacion {
  if (invitacion.estado !== "PENDIENTE") return invitacion.estado;
  return ahora.getTime() >= invitacion.venceEn.getTime() ? "VENCIDA" : "PENDIENTE";
}
