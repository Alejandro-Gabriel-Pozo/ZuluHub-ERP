import {
  estadoEfectivo,
  type EstadoDeEmpresa,
  type EstadoDeTenant,
} from "../../../contexto/estados";
import type {
  EmpresaId,
  InvitacionId,
  PersonaId,
  SucursalId,
  TenantId,
} from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Email } from "./email";
import type { ErrorDeAceptacion, ErrorDeInvitacion } from "./errores";
import type { Persona, RolDeEmpresa } from "./membresia";

/**
 * Invitaciones (diseno-inicial §6.3). Dominio puro: sin reloj ni aleatoriedad. La hora (`ahora`),
 * los ids y el hash del token entran siempre como datos.
 */
export type { RolDeEmpresa };

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

/**
 * Arma una invitación nueva. Orden de los errores: sin empresas, empresa repetida y después la
 * regla del tipo. El alta del gerente exige exactamente una empresa con rol `GERENTE`; la de un
 * usuario no admite el rol `GERENTE` (el gerente se traspasa, no se invita).
 */
export function nuevaInvitacion(
  datos: DatosDeNuevaInvitacion,
  ahora: Date,
): Resultado<NuevaInvitacion, ErrorDeInvitacion> {
  const { empresas, tipo } = datos;
  if (empresas.length === 0) return err("INVITACION_SIN_EMPRESAS");
  if (new Set(empresas.map((e) => e.empresaId)).size !== empresas.length) {
    return err("EMPRESA_REPETIDA");
  }
  if (tipo === "ALTA_GERENTE") {
    const gerentes = empresas.filter((e) => e.rol === "GERENTE");
    if (empresas.length !== 1 || gerentes.length !== 1) return err("ALTA_INVALIDA");
  } else if (empresas.some((e) => e.rol === "GERENTE")) {
    return err("ROL_NO_INVITABLE");
  }
  return ok({
    id: datos.id,
    tokenHash: datos.tokenHash,
    tenantId: datos.tenantId,
    tipo,
    email: datos.email,
    emitidaPor: datos.emitidaPor,
    emitidaEn: ahora,
    venceEn: new Date(ahora.getTime() + PLAZOS_EN_MS[tipo]),
    empresas,
  });
}

export type EstadosDeEmpresa = ReadonlyMap<
  EmpresaId,
  Readonly<{ empresa: EstadoDeEmpresa; tenant: EstadoDeTenant }>
>;

export type DatosDeAceptacion = Readonly<{
  ahora: Date;
  /** Email con el que la persona se autenticó; `null` si no hay sesión verificada. */
  emailAutenticado: Email | null;
  /** La persona ya existente con ese email; `null` si todavía no existe (se crea al aceptar). */
  persona: Persona | null;
  /** Estado de CADA empresa de la invitación; si falta alguna es un error de programación. */
  estados: EstadosDeEmpresa;
  miembroActivoEn: ReadonlySet<EmpresaId>;
  /**
   * El rol que la persona tenía en cada empresa donde ya tuvo una membresía APAGADA. Reactivarla
   * con otro rol no se soporta (el rol de una membresía no se cambia). Sin entrada: nunca fue miembro.
   */
  rolesAnteriores: ReadonlyMap<EmpresaId, RolDeEmpresa>;
}>;

export type DecisionDeAceptacion =
  Readonly<{ tipo: "ACEPTAR" }> | Readonly<{ tipo: "YA_ACEPTADA" }>;

function estadosDe(estados: EstadosDeEmpresa, empresaId: EmpresaId) {
  const encontrado = estados.get(empresaId);
  // Faltar el estado de una empresa de la invitación es un error del llamador, no de negocio: se
  // lanza para no aceptar a ciegas (ADR-004).
  if (encontrado === undefined) throw new RangeError(`falta el estado de la empresa ${empresaId}`);
  return encontrado;
}

/**
 * Decide si se puede aceptar la invitación. Gana el primer error que aplique, en este orden:
 *
 * 1. Alta del gerente cuya empresa ya no está en `PROVISIONING`: `ALTA_NO_PENDIENTE`. No rige
 *    para una alta ya `ACEPTADA` (la empresa ya pasó a `ACTIVE` al aceptarla): ahí manda el
 *    paso 2, para que repetir la aceptación sea idempotente.
 * 2. Ya `ACEPTADA`: `YA_ACEPTADA` (ok, sin escribir) solo si la aceptó esta misma persona; si
 *    la aceptó otra, o no se sabe quién es, `INVITACION_NO_PENDIENTE`.
 * 3. `REVOCADA`: `INVITACION_REVOCADA`.
 * 4. Vencida: `INVITACION_VENCIDA`.
 * 5. El email autenticado no coincide (o no hay): `INVITACION_DE_OTRO_EMAIL`.
 * 6. Persona suspendida globalmente: `PERSONA_SUSPENDIDA`.
 * 7. Alguna empresa no opera: `EMPRESA_NO_OPERA` con la PRIMERA (en el orden de la invitación) y
 *    su motivo. Todo o nada: una sola que no opere rechaza la invitación entera. En el alta del
 *    gerente la empresa está en `PROVISIONING` y la propia aceptación la activa, así que se evalúa
 *    como si ya estuviera `ACTIVE` (solo puede frenarla el tenant suspendido).
 * 8. Ya es miembro activo de alguna empresa: `YA_ES_MIEMBRO`.
 * 9. Tuvo una membresía apagada en alguna empresa con un rol distinto al de la invitación:
 *    `ROL_DISTINTO_AL_ANTERIOR` con la PRIMERA (en el orden de la invitación).
 */
export function decidirAceptacion(
  invitacion: Invitacion,
  datos: DatosDeAceptacion,
): Resultado<DecisionDeAceptacion, ErrorDeAceptacion> {
  const { ahora, emailAutenticado, persona, estados, miembroActivoEn, rolesAnteriores } = datos;
  const esAlta = invitacion.tipo === "ALTA_GERENTE";

  if (esAlta && invitacion.estado !== "ACEPTADA") {
    const enAlta = invitacion.empresas.every(
      (e) => estadosDe(estados, e.empresaId).empresa === "PROVISIONING",
    );
    if (!enAlta) return err("ALTA_NO_PENDIENTE");
  }
  if (invitacion.estado === "ACEPTADA") {
    const laAceptoEstaPersona = persona !== null && invitacion.aceptadaPor === persona.id;
    return laAceptoEstaPersona ? ok({ tipo: "YA_ACEPTADA" }) : err("INVITACION_NO_PENDIENTE");
  }
  if (invitacion.estado === "REVOCADA") return err("INVITACION_REVOCADA");
  if (estadoDeInvitacion(invitacion, ahora) === "VENCIDA") return err("INVITACION_VENCIDA");
  if (emailAutenticado !== invitacion.email) return err("INVITACION_DE_OTRO_EMAIL");
  if (persona !== null && !persona.activoGlobal) return err("PERSONA_SUSPENDIDA");
  for (const { empresaId } of invitacion.empresas) {
    const { empresa, tenant } = estadosDe(estados, empresaId);
    // Stryker disable next-line StringLiteral: `estadoEfectivo` trata cualquier valor que no sea PROVISIONING, SUSPENDED, CANCELLED o DELETING como ACTIVE; el texto vacío es un estado inválido para los tipos que se comporta igual.
    const motivo = estadoEfectivo(tenant, esAlta ? "ACTIVE" : empresa);
    if (motivo !== "OPERA") return err({ codigo: "EMPRESA_NO_OPERA", empresaId, motivo });
  }
  if (invitacion.empresas.some((e) => miembroActivoEn.has(e.empresaId))) {
    return err("YA_ES_MIEMBRO");
  }
  for (const { empresaId, rol } of invitacion.empresas) {
    const anterior = rolesAnteriores.get(empresaId);
    if (anterior !== undefined && anterior !== rol) {
      return err({ codigo: "ROL_DISTINTO_AL_ANTERIOR", empresaId });
    }
  }
  return ok({ tipo: "ACEPTAR" });
}

export type DatosDeInvitacionDeUsuario = Readonly<{
  ahora: Date;
  /** El email ya pertenece a un miembro ACTIVO de la empresa. */
  esMiembroActivo: boolean;
  /**
   * La invitación guardada como `PENDIENTE` que ya incluye a esa empresa para ese email. La base
   * admite a lo sumo una (índice único parcial); puede estar vencida (el vencimiento no se guarda).
   */
  pendiente: Invitacion | null;
}>;

export type DecisionDeInvitacionDeUsuario =
  | Readonly<{ tipo: "CREAR" }>
  /** La pendiente venció: se revoca y nace otra que la reemplaza. */
  | Readonly<{ tipo: "REEMPLAZAR_VENCIDA"; vencida: InvitacionId }>
  /** Ya hay una vigente: se devuelve esa, sin escribir (idempotencia por clave natural). */
  | Readonly<{ tipo: "YA_EXISTE"; invitacion: InvitacionId }>;

/**
 * Decide si se emite una invitación de usuario a una empresa. Orden: quien ya es miembro activo
 * (`YA_ES_MIEMBRO`); sin pendiente se crea; con una vigente se devuelve esa; con una vencida se
 * reemplaza. Una invitación que no está guardada como `PENDIENTE` es un error del llamador y lanza.
 */
export function decidirInvitacionDeUsuario(
  datos: DatosDeInvitacionDeUsuario,
): Resultado<DecisionDeInvitacionDeUsuario, "YA_ES_MIEMBRO"> {
  const { ahora, esMiembroActivo, pendiente } = datos;
  if (esMiembroActivo) return err("YA_ES_MIEMBRO");
  if (pendiente === null) return ok({ tipo: "CREAR" });
  if (pendiente.estado !== "PENDIENTE") {
    throw new RangeError(`la invitación ${pendiente.id} no está pendiente`);
  }
  return estadoDeInvitacion(pendiente, ahora) === "VENCIDA"
    ? ok({ tipo: "REEMPLAZAR_VENCIDA", vencida: pendiente.id })
    : ok({ tipo: "YA_EXISTE", invitacion: pendiente.id });
}

export type DatosDeReenvio = Readonly<{
  id: InvitacionId;
  tokenHash: string;
  /** Quien reenvía: es el emisor de la invitación nueva. */
  emitidaPor: PersonaId | null;
}>;

export type DecisionDeReenvio =
  | Readonly<{ tipo: "REENVIAR"; nueva: NuevaInvitacion }>
  | Readonly<{ tipo: "YA_REENVIADA"; nueva: InvitacionId }>;

/**
 * Decide el reenvío de una invitación de usuario: la anterior se revoca (queda `reemplazada_por`)
 * y nace otra con otro id y otro token, por el plazo completo. Orden de los errores: el alta del
 * gerente no se reenvía (`REENVIO_NO_PERMITIDO`); si ya fue reemplazada se devuelve la misma
 * reemplazante (`YA_REENVIADA`, idempotente, aunque esté revocada); una aceptada es
 * `INVITACION_NO_PENDIENTE`; una revocada sin reemplazo es `INVITACION_REVOCADA`. Una pendiente
 * vencida sí se reenvía: es el caso típico.
 */
export function decidirReenvio(
  invitacion: Invitacion,
  ahora: Date,
  nueva: DatosDeReenvio,
): Resultado<DecisionDeReenvio, ErrorDeInvitacion> {
  if (invitacion.tipo === "ALTA_GERENTE") return err("REENVIO_NO_PERMITIDO");
  if (invitacion.reemplazadaPor !== null) {
    return ok({ tipo: "YA_REENVIADA", nueva: invitacion.reemplazadaPor });
  }
  if (invitacion.estado === "ACEPTADA") return err("INVITACION_NO_PENDIENTE");
  if (invitacion.estado === "REVOCADA") return err("INVITACION_REVOCADA");
  const creada = nuevaInvitacion(
    {
      id: nueva.id,
      tokenHash: nueva.tokenHash,
      tenantId: invitacion.tenantId,
      tipo: invitacion.tipo,
      email: invitacion.email,
      empresas: invitacion.empresas,
      emitidaPor: nueva.emitidaPor,
    },
    ahora,
  );
  return creada.ok ? ok({ tipo: "REENVIAR", nueva: creada.valor }) : creada;
}
