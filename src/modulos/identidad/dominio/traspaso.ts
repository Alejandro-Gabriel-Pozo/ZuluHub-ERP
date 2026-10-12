import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type {
  ErrorDeAceptacionDeTraspaso,
  ErrorDeCancelacionDeTraspaso,
  ErrorDePropuestaDeTraspaso,
  ErrorDeRechazoDeTraspaso,
} from "./errores";
import type { Membresia, Persona } from "./membresia";

/**
 * Traspaso de gerencia (H6, especificación §B.3). Dominio puro: sin reloj ni azar; la hora (`ahora`)
 * y los hechos leídos en la transacción (membresías, personas, el gerente vigente) entran como datos.
 * El gerente actual (o la plataforma) propone a un miembro activo, que acepta o rechaza; sin
 * aceptación no cambia nada. Al aceptar, el saliente baja a administrador y el entrante pasa a
 * gerente: eso lo hace el caso de uso en una sola transacción, una vez que estas decisiones dicen `ACEPTAR`.
 */

export type OrigenDeTraspaso = "GERENTE" | "PLATAFORMA";

/** Estados que se guardan. `VENCIDO` no se guarda: se calcula con `ahora`. */
export type EstadoGuardadoDeTraspaso = "PROPUESTO" | "ACEPTADO" | "RECHAZADO" | "CANCELADO";

export type EstadoDeTraspaso = EstadoGuardadoDeTraspaso | "VENCIDO";

/** Supuesto de plazo (§B.3): la propuesta vence a los 7 días, igual que la invitación de un usuario. */
export const PLAZO_DEL_TRASPASO_EN_MS = 7 * 24 * 3_600_000;

/**
 * Transiciones permitidas del estado guardado. La base impone la misma tabla con un disparador;
 * un test compara ambas.
 */
export const TRANSICIONES_DE_TRASPASO: Readonly<
  Record<EstadoGuardadoDeTraspaso, readonly EstadoGuardadoDeTraspaso[]>
> = {
  PROPUESTO: ["ACEPTADO", "RECHAZADO", "CANCELADO"],
  ACEPTADO: [],
  RECHAZADO: [],
  CANCELADO: [],
};

export type Traspaso = Readonly<{
  /** `string` hasta que los casos de uso (T4) definan el identificador con marca. */
  id: string;
  empresaId: EmpresaId;
  origen: OrigenDeTraspaso;
  /**
   * El gerente que propuso. En el origen `PLATAFORMA` es `null` hasta que se acepta: ahí se completa
   * con el gerente vigente de ese momento.
   */
  salientePersonaId: PersonaId | null;
  entrantePersonaId: PersonaId;
  estado: EstadoGuardadoDeTraspaso;
  venceEn: Date;
  version: number;
}>;

/** Cuándo vence una propuesta hecha en `propuestoEn`. */
export function vencimientoDeTraspaso(propuestoEn: Date): Date {
  return new Date(propuestoEn.getTime() + PLAZO_DEL_TRASPASO_EN_MS);
}

/** Un traspaso propuesto cuyo vencimiento llegó (`ahora >= venceEn`) pasa a `VENCIDO`. */
export function estadoDeTraspaso(traspaso: Traspaso, ahora: Date): EstadoDeTraspaso {
  if (traspaso.estado !== "PROPUESTO") return traspaso.estado;
  return ahora.getTime() >= traspaso.venceEn.getTime() ? "VENCIDO" : "PROPUESTO";
}

export type DecisionDePropuesta = "YA_EXISTIA" | "CANCELAR_VENCIDO_Y_PROPONER" | "PROPONER";

/**
 * Decide si se propone el traspaso a `entrante` (su membresía en la empresa; `null` si no tiene).
 * `enCurso` es el traspaso guardado como `PROPUESTO` de la empresa (la base admite a lo sumo uno;
 * puede estar vencido) y `entrantePersona` su persona. `actorId` es quien propone; `null` es la
 * plataforma. Orden: no es miembro (`ENTRANTE_NO_ES_MIEMBRO`); membresía apagada o persona suspendida
 * (`ENTRANTE_INACTIVO`); el entrante es el gerente o el propio actor (`ENTRANTE_ES_EL_GERENTE`).
 * Después, sin propuesta en curso se propone; con una vencida se la cancela y se propone (aunque
 * sea al mismo entrante: se renueva); con una vigente al mismo entrante se devuelve esa
 * (`YA_EXISTIA`, idempotente) y a otro es `TRASPASO_EN_CURSO`. Un `enCurso` que no está guardado
 * como `PROPUESTO` es un error del llamador y lanza.
 */
export function decidirPropuesta(
  enCurso: Traspaso | null,
  entrante: Membresia | null,
  entrantePersona: Persona | null,
  actorId: PersonaId | null,
  ahora: Date,
): Resultado<DecisionDePropuesta, ErrorDePropuestaDeTraspaso> {
  if (enCurso !== null && enCurso.estado !== "PROPUESTO") {
    throw new RangeError(`el traspaso ${enCurso.id} no está propuesto`);
  }
  if (entrante === null) return err("ENTRANTE_NO_ES_MIEMBRO");
  if (!entrante.activo || entrantePersona === null || !entrantePersona.activoGlobal) {
    return err("ENTRANTE_INACTIVO");
  }
  if (entrante.rol === "GERENTE" || entrante.personaId === actorId) {
    return err("ENTRANTE_ES_EL_GERENTE");
  }
  if (enCurso === null) return ok("PROPONER");
  if (estadoDeTraspaso(enCurso, ahora) === "VENCIDO") return ok("CANCELAR_VENCIDO_Y_PROPONER");
  return enCurso.entrantePersonaId === entrante.personaId
    ? ok("YA_EXISTIA")
    : err("TRASPASO_EN_CURSO");
}

export type DecisionDeAceptacionDeTraspaso = "YA_ACEPTADO" | "ACEPTAR";

/**
 * Decide si el entrante acepta. `gerenteVigente` es la membresía del gerente activo de la empresa
 * (leída en la misma transacción; `null` si no hay) y `entrante` la del entrante. Gana el primer
 * error que aplique, en este orden:
 *
 * 1. No existe: `TRASPASO_NO_ENCONTRADO`.
 * 2. `actorId` no es el entrante: `TRASPASO_NO_ES_PARA_VOS` (antes de decir en qué estado está).
 * 3. Ya aceptado: `YA_ACEPTADO` (ok, sin escribir; el entrante repite la aceptación).
 * 4. Rechazado o cancelado: `TRASPASO_RESUELTO`.
 * 5. Vencido: `TRASPASO_VENCIDO`.
 * 6. El saliente ya no es el gerente (o no hay gerente): `SALIENTE_YA_NO_ES_GERENTE`. Con origen
 *    `GERENTE` el saliente es el que propuso; con `PLATAFORMA` lo es el gerente vigente.
 * 7. El entrante no existe o está apagado: `ENTRANTE_INACTIVO`.
 * 8. El entrante ya es gerente: `ENTRANTE_ES_EL_GERENTE` (no hay a quién pasarle la gerencia: así
 *    un traspaso aceptado nunca deja al gerente dos veces ni sin gerente).
 */
export function decidirAceptacionDeTraspaso(
  traspaso: Traspaso | null,
  actorId: PersonaId,
  gerenteVigente: Membresia | null,
  entrante: Membresia | null,
  ahora: Date,
): Resultado<DecisionDeAceptacionDeTraspaso, ErrorDeAceptacionDeTraspaso> {
  if (traspaso === null) return err("TRASPASO_NO_ENCONTRADO");
  if (traspaso.entrantePersonaId !== actorId) return err("TRASPASO_NO_ES_PARA_VOS");
  const estado = estadoDeTraspaso(traspaso, ahora);
  if (estado === "ACEPTADO") return ok("YA_ACEPTADO");
  if (estado === "RECHAZADO" || estado === "CANCELADO") return err("TRASPASO_RESUELTO");
  if (estado === "VENCIDO") return err("TRASPASO_VENCIDO");
  if (
    gerenteVigente === null ||
    (traspaso.salientePersonaId !== null && gerenteVigente.personaId !== traspaso.salientePersonaId)
  ) {
    return err("SALIENTE_YA_NO_ES_GERENTE");
  }
  if (entrante === null || !entrante.activo) return err("ENTRANTE_INACTIVO");
  if (entrante.rol === "GERENTE") return err("ENTRANTE_ES_EL_GERENTE");
  return ok("ACEPTAR");
}

export type DecisionDeRechazo = "YA_RECHAZADO" | "RECHAZAR";

/**
 * Decide si el entrante rechaza. Mismo orden que la aceptación, sin las condiciones de las
 * membresías (rechazar no cambia roles): no existe, no es para `actorId`, ya rechazado (ok
 * `YA_RECHAZADO`), aceptado o cancelado (`TRASPASO_RESUELTO`), vencido (`TRASPASO_VENCIDO`).
 */
export function decidirRechazo(
  traspaso: Traspaso | null,
  actorId: PersonaId,
  ahora: Date,
): Resultado<DecisionDeRechazo, ErrorDeRechazoDeTraspaso> {
  if (traspaso === null) return err("TRASPASO_NO_ENCONTRADO");
  if (traspaso.entrantePersonaId !== actorId) return err("TRASPASO_NO_ES_PARA_VOS");
  const estado = estadoDeTraspaso(traspaso, ahora);
  if (estado === "RECHAZADO") return ok("YA_RECHAZADO");
  if (estado === "ACEPTADO" || estado === "CANCELADO") return err("TRASPASO_RESUELTO");
  if (estado === "VENCIDO") return err("TRASPASO_VENCIDO");
  return ok("RECHAZAR");
}

export type DecisionDeCancelacion = "YA_NO_HABIA" | "CANCELAR";

/**
 * Decide si se cancela la propuesta (la cancela el gerente; el permiso lo verifica el guard).
 * `traspaso` es la propuesta en curso de la empresa o, si no hay, `null`. Sin propuesta, o ya
 * cancelada, no hay nada que hacer: `YA_NO_HABIA` (ok, idempotente). Una vigente o una vencida que
 * sigue guardada como `PROPUESTO` se cancela (la vencida se cancela igual: así se libera el lugar
 * sin error). Aceptado o rechazado es otra historia: `TRASPASO_RESUELTO`.
 */
export function decidirCancelacion(
  traspaso: Traspaso | null,
  ahora: Date,
): Resultado<DecisionDeCancelacion, ErrorDeCancelacionDeTraspaso> {
  if (traspaso === null) return ok("YA_NO_HABIA");
  const estado = estadoDeTraspaso(traspaso, ahora);
  if (estado === "CANCELADO") return ok("YA_NO_HABIA");
  if (estado === "ACEPTADO" || estado === "RECHAZADO") return err("TRASPASO_RESUELTO");
  return ok("CANCELAR");
}
