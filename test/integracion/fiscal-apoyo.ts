import { randomUUID } from "node:crypto";
import type pg from "pg";
import { expect } from "vitest";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import { comoEmpresa, comoPlataforma, cuitAlAzar } from "./entorno";
import type { BaseDePruebas } from "./global";
import { SesionDePrueba, type Intento } from "./sesiones";

/**
 * Apoyo de las pruebas de la migración 0006 (H7 fiscal). Todo se arma con el cliente del DUEÑO de la
 * base (evade RLS): sirve para dejar listo el escenario; lo que se prueba después se hace con los
 * roles limitados y su contexto firmado (`SesionDePrueba`) o, para lo que la base impone aun al
 * dueño, con el mismo cliente del dueño.
 */

export type EstadoDeEmpresaDePrueba =
  "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | "DELETING";

/** Una empresa con su tenant, una sucursal, una persona (el «gerente» que firma) y su emisor principal. */
export type Mundo = Readonly<{
  tenant: string;
  empresa: string;
  cuit: string;
  sucursal: string;
  persona: string;
  /** El emisor principal, creado por el disparador de la empresa. */
  emisor: string;
}>;

export async function crearMundo(
  c: pg.Client,
  opciones: {
    tenant?: string;
    estado?: EstadoDeEmpresaDePrueba;
    cuit?: string;
    /** En una base a la que todavía le falta 0006 no hay emisor que buscar (`emisor` queda vacío). */
    sinEmisor?: boolean;
  } = {},
): Promise<Mundo> {
  const un = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
    (await c.query<T>(texto, p)).rows[0] as T;
  const tenant =
    opciones.tenant ??
    (
      await un<{ id: string }>("insert into tenant (nombre) values ($1) returning id", [
        `tenant-${randomUUID().slice(0, 8)}`,
      ])
    ).id;
  const estado = opciones.estado ?? "ACTIVE";
  const cuit = opciones.cuit ?? cuitAlAzar();
  const empresa = (
    await un<{ id: string }>(
      `insert into empresa (tenant_id, cuit, razon_social, estado, motivo_estado)
       values ($1, $2, $3, $4, $5) returning id`,
      [
        tenant,
        cuit,
        `empresa-${randomUUID().slice(0, 8)}`,
        estado,
        estado === "SUSPENDED" || estado === "CANCELLED" ? "prueba" : null,
      ],
    )
  ).id;
  const sucursal = (
    await un<{ id: string }>(
      "insert into sucursal (empresa_id, nombre) values ($1, 'Casa central') returning id",
      [empresa],
    )
  ).id;
  const persona = (
    await un<{ id: string }>("insert into persona (email) values ($1) returning id", [
      `${randomUUID().slice(0, 12)}@prueba.test`,
    ])
  ).id;
  const emisor =
    opciones.sinEmisor === true
      ? ""
      : (
          await un<{ id: string }>("select id from emisor where empresa_id = $1 and es_principal", [
            empresa,
          ])
        ).id;
  return { tenant, empresa, cuit, sucursal, persona, emisor };
}

export type DatosDeDomicilio = Partial<
  Readonly<{
    id: string;
    calle: string;
    numero: string;
    piso: string | null;
    departamento: string | null;
    localidad: string;
    provincia: string;
    codigo_postal: string | null;
  }>
>;

export async function crearDomicilio(
  c: pg.Client,
  empresa: string,
  datos: DatosDeDomicilio = {},
): Promise<string> {
  const id = datos.id ?? randomUUID();
  await c.query(
    `insert into domicilio (id, empresa_id, calle, numero, piso, departamento, localidad, provincia, codigo_postal)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      empresa,
      datos.calle ?? "Av. Corrientes",
      datos.numero ?? "1234",
      datos.piso ?? null,
      datos.departamento ?? null,
      datos.localidad ?? "Rosario",
      datos.provincia ?? "AR-S",
      datos.codigo_postal ?? "S2000",
    ],
  );
  return id;
}

export async function crearPuntoDeVenta(
  c: pg.Client,
  m: Mundo,
  datos: {
    id?: string;
    numero?: number;
    emisor?: string;
    sucursal?: string;
    domicilio?: string | null;
    activo?: boolean;
  } = {},
): Promise<string> {
  const id = datos.id ?? randomUUID();
  const domicilio =
    datos.domicilio === undefined
      ? datos.activo === true
        ? await crearDomicilio(c, m.empresa)
        : null
      : datos.domicilio;
  await c.query(
    `insert into punto_de_venta (id, empresa_id, emisor_id, sucursal_id, numero, domicilio_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      m.empresa,
      datos.emisor ?? m.emisor,
      datos.sucursal ?? m.sucursal,
      datos.numero ?? 1,
      domicilio,
    ],
  );
  if (datos.activo === true) {
    await c.query("update punto_de_venta set estado = 'ACTIVO' where id = $1", [id]);
  }
  return id;
}

export async function crearSerie(
  c: pg.Client,
  empresa: string,
  puntoDeVenta: string,
  emisor: string,
  tipo = "FACTURA_B",
  ultimo = 0,
): Promise<void> {
  await c.query(
    `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero)
     values ($1, $2, $3, $4, $5)`,
    [empresa, puntoDeVenta, emisor, tipo, ultimo],
  );
}

/** Deja una serie en el estado pedido (usada: `ultimo_numero > 0`, EN_CURSO o BLOQUEADA). */
export async function usarSerie(
  c: pg.Client,
  puntoDeVenta: string,
  como: "NUMERO" | "EN_CURSO" | "BLOQUEADA",
  tipo = "FACTURA_B",
): Promise<void> {
  if (como === "NUMERO") {
    await c.query(
      `update serie_comprobante set estado = 'EN_CURSO', numero_en_curso = ultimo_numero + 1,
              solicitud_en_curso = $3, en_curso_hasta = now() + interval '5 minutes'
        where punto_de_venta_id = $1 and tipo_comprobante = $2`,
      [puntoDeVenta, tipo, randomUUID()],
    );
    await c.query(
      `update serie_comprobante set estado = 'LIBRE', ultimo_numero = numero_en_curso, numero_en_curso = null,
              solicitud_en_curso = null, en_curso_hasta = null
        where punto_de_venta_id = $1 and tipo_comprobante = $2`,
      [puntoDeVenta, tipo],
    );
  } else if (como === "EN_CURSO") {
    await c.query(
      `update serie_comprobante set estado = 'EN_CURSO', numero_en_curso = ultimo_numero + 1,
              solicitud_en_curso = $3, en_curso_hasta = now() + interval '5 minutes'
        where punto_de_venta_id = $1 and tipo_comprobante = $2`,
      [puntoDeVenta, tipo, randomUUID()],
    );
  } else {
    await c.query(
      `update serie_comprobante set estado = 'EN_CURSO', numero_en_curso = ultimo_numero + 1,
              solicitud_en_curso = $3, en_curso_hasta = now() + interval '5 minutes'
        where punto_de_venta_id = $1 and tipo_comprobante = $2`,
      [puntoDeVenta, tipo, randomUUID()],
    );
    await c.query(
      `update serie_comprobante set estado = 'BLOQUEADA', numero_en_curso = null, solicitud_en_curso = null,
              en_curso_hasta = null, motivo_bloqueo = 'desfase de prueba'
        where punto_de_venta_id = $1 and tipo_comprobante = $2`,
      [puntoDeVenta, tipo],
    );
  }
}

/** Una sentencia del dueño dentro de un savepoint: si falla, la transacción sigue sana. */
export async function intentoDelDueno(
  c: pg.Client,
  texto: string,
  parametros: unknown[] = [],
): Promise<Intento> {
  await c.query("savepoint intento");
  try {
    const r = await c.query(texto, parametros);
    await c.query("release savepoint intento");
    return { ok: true, filas: r.rowCount ?? 0, rows: r.rows as Record<string, unknown>[] };
  } catch (error) {
    await c.query("rollback to savepoint intento");
    const e = error as { code?: string; constraint?: string; message?: string };
    return {
      ok: false,
      codigo: e.code ?? "?",
      restriccion: e.constraint,
      mensaje: e.message ?? "",
    };
  }
}

/** Todo lo que haga el trabajo se deshace: el dueño prueba una cosa a la vez. */
export async function sinConfirmar<T>(c: pg.Client, trabajo: () => Promise<T>): Promise<T> {
  await c.query("begin");
  try {
    return await trabajo();
  } finally {
    await c.query("rollback");
  }
}

// ---- aserciones sobre un intento ---------------------------------------------------------------

function rechazado(r: Intento, codigo: string, restriccion?: string): void {
  expect(r.ok, "tenía que rechazarse").toBe(false);
  if (r.ok) return;
  expect(r.codigo, r.mensaje).toBe(codigo);
  if (restriccion !== undefined) expect(r.restriccion, r.mensaje).toBe(restriccion);
}
export const denegado = (r: Intento) => rechazado(r, "42501");
export const check = (r: Intento, restriccion: string) => rechazado(r, "23514", restriccion);
export const clave = (r: Intento, restriccion: string) => rechazado(r, "23505", restriccion);
export const referencia = (r: Intento, restriccion: string) => rechazado(r, "23503", restriccion);
export function filas(r: Intento, n: number): void {
  expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
  if (r.ok) expect(r.filas).toBe(n);
}
export function acepta(r: Intento): void {
  expect(r.ok, r.ok ? "" : `${r.codigo} ${r.restriccion ?? ""}: ${r.mensaje}`).toBe(true);
}

// ---- sesiones con el rol real ------------------------------------------------------------------

/** Una sesión de la aplicación en esa empresa (con esa persona); todo se deshace al terminar. */
export async function conAppDe<T>(
  base: BaseDePruebas,
  m: Pick<Mundo, "empresa" | "persona">,
  trabajo: (s: SesionDePrueba) => Promise<T>,
  persona: string | null = m.persona,
  aislamiento: "read committed" | "repeatable read" | "serializable" = "read committed",
): Promise<T> {
  const s = await SesionDePrueba.abrir(
    base,
    "zuluhub_app",
    comoEmpresa(empresaId(m.empresa), persona === null ? null : personaId(persona)),
    aislamiento,
  );
  try {
    return await trabajo(s);
  } finally {
    await s.cerrar();
  }
}

export type ActorDePrueba = "ADMIN" | "SOPORTE" | "SISTEMA";

/** Una sesión de la plataforma con ese actor firmado; todo se deshace al terminar. */
export async function conPlataformaDe<T>(
  base: BaseDePruebas,
  actor: ActorDePrueba,
  trabajo: (s: SesionDePrueba) => Promise<T>,
): Promise<T> {
  const contexto =
    actor === "ADMIN"
      ? comoPlataforma()
      : actor === "SOPORTE"
        ? comoPlataforma({ tipo: "ADMIN", id: SOPORTE_DE_PRUEBA })
        : comoPlataforma({ tipo: "SISTEMA", proceso: "prueba" });
  const s = await SesionDePrueba.abrir(base, "zuluhub_plataforma", contexto);
  try {
    return await trabajo(s);
  } finally {
    await s.cerrar();
  }
}
