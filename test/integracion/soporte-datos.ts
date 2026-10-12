import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { ContextoDePlataforma } from "../../src/contexto/contexto";
import type { EstadoDeEmpresa } from "../../src/contexto/estados";
import { cuitAlAzar, nombreAlAzar } from "./entorno";
import { ADMIN_DE_PRUEBA } from "./admins-de-prueba";

/**
 * Datos de las pruebas de soporte de plataforma (H5 P6). Todo se arma con el cliente del DUEÑO de la
 * base (evade RLS): sirve para dejar listo el escenario; lo que se prueba después pasa por los roles
 * limitados y el contexto firmado.
 */

/** Un contexto de plataforma con la hora que se indique (el `ahora` del caso de uso). */
export const plataformaEn = (
  ahora: Date,
  actor: ContextoDePlataforma["actor"] = { tipo: "ADMIN", id: ADMIN_DE_PRUEBA },
): ContextoDePlataforma => ({ tipo: "PLATAFORMA", actor, ahora });

export async function sembrarTenant(
  c: pg.Client,
  opciones: { nombre?: string; suspendido?: boolean } = {},
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    "insert into tenant (nombre) values ($1) returning id",
    [opciones.nombre ?? nombreAlAzar("tenant")],
  );
  const id = rows[0]?.id as string;
  if (opciones.suspendido === true) {
    await c.query(
      "update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
      [id],
    );
  }
  return id;
}

/**
 * Una empresa en el estado pedido (por las transiciones permitidas). `creadoEn` fija cuándo se creó,
 * para calcular el plazo del alta. Con un tenant suspendido se la crea ANTES de suspenderlo (la base no
 * deja dar de alta empresas en un tenant suspendido): usar `suspenderTenant` después.
 */
export async function sembrarEmpresa(
  c: pg.Client,
  tenant: string,
  opciones: { estado?: EstadoDeEmpresa; creadoEn?: Date; razonSocial?: string } = {},
): Promise<string> {
  const estado = opciones.estado ?? "ACTIVE";
  const { rows } = await c.query<{ id: string }>(
    "insert into empresa (tenant_id, cuit, razon_social) values ($1, $2, $3) returning id",
    [tenant, cuitAlAzar(), opciones.razonSocial ?? nombreAlAzar("empresa")],
  );
  const id = rows[0]?.id as string;
  if (estado === "ACTIVE" || estado === "SUSPENDED" || estado === "DELETING") {
    await c.query("update empresa set estado = 'ACTIVE' where id = $1", [id]);
  }
  if (estado === "SUSPENDED") {
    await c.query(
      "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
      [id],
    );
  }
  if (estado === "CANCELLED") {
    await c.query(
      "update empresa set estado = 'CANCELLED', motivo_estado = 'prueba' where id = $1",
      [id],
    );
  }
  if (estado === "DELETING") {
    await c.query("update empresa set estado = 'DELETING' where id = $1", [id]);
  }
  if (opciones.creadoEn !== undefined) {
    await c.query("update empresa set creado_en = $2 where id = $1", [id, opciones.creadoEn]);
  }
  return id;
}

export async function suspenderTenant(c: pg.Client, tenant: string): Promise<void> {
  await c.query("update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1", [
    tenant,
  ]);
}

/** Un trabajo en estado FALLIDO (lo deja así la cola tras agotar los reintentos). */
export async function sembrarTrabajoFallido(
  c: pg.Client,
  datos: {
    empresa?: string | null;
    tipo?: string;
    datos?: unknown;
    intentos?: number;
    ultimoError?: string | null;
  } = {},
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into trabajo (empresa_id, tipo, datos, clave_idempotencia, estado, intentos, ultimo_error)
     values ($1, $2, $3, $4, 'FALLIDO', $5, $6) returning id`,
    [
      datos.empresa ?? null,
      datos.tipo ?? "enviar_invitacion",
      JSON.stringify(datos.datos ?? {}),
      `clave-secreta-${randomUUID()}`,
      datos.intentos ?? 5,
      datos.ultimoError ?? "MAIL_RECHAZADO",
    ],
  );
  return rows[0]?.id as string;
}
