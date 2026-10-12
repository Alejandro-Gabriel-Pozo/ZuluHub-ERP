import { estadoDeInvitacion, type Invitacion } from "../../../modulos/identidad/publico";
import type { EmpresaId, TenantId } from "../../../primitivas/identificadores/marca";
import { altaVencida, msRestantesDeAlta } from "../alta";

/**
 * La vista de soporte de un alta que sigue pendiente (H5 §B.5.9, nivel 1): cómo está la invitación del
 * gerente y cuánto falta para que el alta venza. Dominio puro: la hora entra como dato, y el estado de
 * la invitación y el plazo del alta salen de las MISMAS funciones que usan los casos reales
 * (`estadoDeInvitacion`, `altaVencida`, `msRestantesDeAlta`), así que la vista no puede contradecirlos.
 */

/** Cómo está la última invitación del alta; `SIN_INVITACION` si la empresa nunca tuvo una. */
export type EstadoDeLaInvitacionDelAlta =
  "SIN_INVITACION" | "VIGENTE" | "VENCIDA" | "ACEPTADA" | "REVOCADA";

/** De la empresa en alta, lo que la vista necesita. */
export type EmpresaEnAlta = Readonly<{
  id: EmpresaId;
  tenantId: TenantId;
  razonSocial: string;
  creadoEn: Date;
}>;

export type VistaDeAlta = Readonly<{
  empresaId: EmpresaId;
  tenantId: TenantId;
  razonSocial: string;
  creadaEn: Date;
  estadoDeLaInvitacion: EstadoDeLaInvitacionDelAlta;
  /** Cuándo vence la invitación del alta; `null` si no hay. */
  invitacionVenceEn: Date | null;
  /** Cuánto falta para que venza el alta (72 h desde que se creó la empresa); 0 si ya venció. */
  msRestantes: number;
  /** Horas que faltan, redondeadas hacia arriba: es 0 solo si el alta ya venció. */
  horasRestantes: number;
  /** El alta ya cumplió el plazo: el barrido la cancela. */
  vencida: boolean;
}>;

const MS_POR_HORA = 3_600_000;

function estadoDeLaInvitacionDelAlta(
  invitacion: Invitacion | null,
  ahora: Date,
): EstadoDeLaInvitacionDelAlta {
  if (invitacion === null) return "SIN_INVITACION";
  const estado = estadoDeInvitacion(invitacion, ahora);
  return estado === "PENDIENTE" ? "VIGENTE" : estado;
}

/**
 * Arma la vista de un alta pendiente con su última invitación (`null` si no tiene). El plazo cuenta
 * desde que se creó la empresa, no desde la invitación (decisión 5): reenviar no lo extiende.
 */
export function vistaDeAlta(
  empresa: EmpresaEnAlta,
  ultimaInvitacion: Invitacion | null,
  ahora: Date,
): VistaDeAlta {
  const msRestantes = msRestantesDeAlta(empresa.creadoEn, ahora);
  return {
    empresaId: empresa.id,
    tenantId: empresa.tenantId,
    razonSocial: empresa.razonSocial,
    creadaEn: empresa.creadoEn,
    estadoDeLaInvitacion: estadoDeLaInvitacionDelAlta(ultimaInvitacion, ahora),
    invitacionVenceEn: ultimaInvitacion === null ? null : ultimaInvitacion.venceEn,
    msRestantes,
    horasRestantes: Math.ceil(msRestantes / MS_POR_HORA),
    vencida: altaVencida(empresa.creadoEn, ahora),
  };
}
