import { createHash, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";

/**
 * Datos de identidad para las pruebas de integración (H3). Todo se arma con el cliente del DUEÑO de
 * la base (evade RLS): sirve para dejar listo el escenario; lo que se prueba después se hace con los
 * roles limitados y su contexto firmado.
 */

/** Hash de un token como lo guarda la base: sha256 en hexadecimal minúscula (64 caracteres). */
export const hashDeToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const emailAlAzar = (prefijo = "u"): string =>
  `${prefijo}-${randomBytes(5).toString("hex")}@prueba.test`;

/** Un token al azar y su hash: la base nunca ve el token. */
export const tokenAlAzar = (): { token: string; tokenHash: string } => {
  const token = randomBytes(24).toString("hex");
  return { token, tokenHash: hashDeToken(token) };
};

export type TipoDeInvitacionDePrueba = "ALTA_GERENTE" | "USUARIO";
export type RolDePrueba = "GERENTE" | "ADMINISTRADOR" | "OPERADOR";

export type InvitacionDePrueba = Readonly<{
  id: string;
  tenant: string;
  tipo: TipoDeInvitacionDePrueba;
  email: string;
  tokenHash: string;
}>;

/** Cuándo se emite y cuándo vence una invitación de prueba (el `ahora` de las pruebas es el 11/10). */
export const EMITIDA_EN = new Date("2026-10-10T12:00:00Z");
export const VENCE_EN = new Date("2026-10-17T12:00:00Z");

export async function crearPersonaDeBase(
  c: pg.Client,
  email: string = emailAlAzar("persona"),
): Promise<{ id: string; email: string }> {
  const { rows } = await c.query<{ id: string }>(
    "insert into persona (email) values ($1) returning id",
    [email],
  );
  return { id: rows[0]?.id as string, email };
}

export async function sucursalDe(c: pg.Client, empresa: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    "select id from sucursal where empresa_id = $1 order by nombre limit 1",
    [empresa],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("la empresa de prueba no tiene sucursal");
  return id;
}

export async function crearInvitacionDeBase(
  c: pg.Client,
  datos: {
    tenant: string;
    tipo?: TipoDeInvitacionDePrueba;
    email?: string;
    emitidaPor?: string | null;
    emitidaEn?: Date;
    venceEn?: Date;
  },
): Promise<InvitacionDePrueba> {
  const id = randomUUID();
  const email = datos.email ?? emailAlAzar("invitado");
  const tipo = datos.tipo ?? "USUARIO";
  const { tokenHash } = tokenAlAzar();
  await c.query(
    `insert into invitacion (id, tenant_id, tipo, email, token_hash, emitida_en, vence_en, emitida_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      datos.tenant,
      tipo,
      email,
      tokenHash,
      datos.emitidaEn ?? EMITIDA_EN,
      datos.venceEn ?? VENCE_EN,
      datos.emitidaPor ?? null,
    ],
  );
  return { id, tenant: datos.tenant, tipo, email, tokenHash };
}

/** Suma una empresa (con su rol y, si se quiere, sus sucursales) a una invitación ya creada. */
export async function incluirEmpresa(
  c: pg.Client,
  invitacion: InvitacionDePrueba,
  empresa: string,
  rol: RolDePrueba = "OPERADOR",
  sucursales: readonly string[] = [],
): Promise<void> {
  await c.query(
    `insert into invitacion_empresa (invitacion_id, empresa_id, tenant_id, rol, email, token_hash, tipo)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      invitacion.id,
      empresa,
      invitacion.tenant,
      rol,
      invitacion.email,
      invitacion.tokenHash,
      invitacion.tipo,
    ],
  );
  for (const sucursal of sucursales) {
    await c.query(
      "insert into invitacion_sucursal (invitacion_id, empresa_id, sucursal_id) values ($1, $2, $3)",
      [invitacion.id, empresa, sucursal],
    );
  }
}

export async function crearMembresiaDeBase(
  c: pg.Client,
  empresa: string,
  persona: string,
  rol: RolDePrueba = "OPERADOR",
  activo = true,
): Promise<void> {
  await c.query(
    "insert into membresia (empresa_id, persona_id, rol, activo) values ($1, $2, $3, $4)",
    [empresa, persona, rol, activo],
  );
}

/** Marca la invitación como aceptada por una persona (que tiene que tener el email de la invitación). */
export async function aceptarDeBase(
  c: pg.Client,
  invitacion: InvitacionDePrueba,
  persona: string,
  aceptadaEn: Date = new Date("2026-10-11T12:00:00Z"),
): Promise<void> {
  await c.query(
    "update invitacion set estado = 'ACEPTADA', aceptada_por = $2, aceptada_en = $3 where id = $1",
    [invitacion.id, persona, aceptadaEn],
  );
}

export async function revocarDeBase(
  c: pg.Client,
  invitacion: InvitacionDePrueba,
  motivo = "prueba",
): Promise<void> {
  await c.query(
    "update invitacion set estado = 'REVOCADA', revocada_en = $2, motivo_revocacion = $3 where id = $1",
    [invitacion.id, new Date("2026-10-11T12:00:00Z"), motivo],
  );
}
