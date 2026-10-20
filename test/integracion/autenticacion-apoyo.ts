import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import {
  usuarioAuthId,
  type MarcaComercialId,
  type UsuarioAuthId,
} from "../../src/primitivas/identificadores/marca";
import { comoInvitacion, comoSesion } from "./entorno";
import { emailAlAzar, type RolDePrueba } from "./fixtures-identidad";
import type { BaseDePruebas } from "./global";
import {
  CARPETA_DE_MIGRACIONES,
  carpetaCon,
  crearMundoDeMarca,
  type MundoDeMarca,
} from "./marcas-apoyo";
import { SesionDePrueba } from "./sesiones";

/**
 * Apoyo de las pruebas de la migración 0010 (autenticación, W3a). Todo se arma con el cliente del DUEÑO de la
 * base (evade RLS): sirve para dejar listo el escenario; lo que se prueba después se hace con el rol limitado
 * de la aplicación y su contexto firmado (`SesionDePrueba`) o, para lo que la base impone aun al dueño, con el
 * mismo cliente del dueño.
 */

/** Un usuario de la librería de autenticación (la tabla `autenticacion."user"`), como lo dejaría el ingreso. */
export async function crearUsuarioDeBase(
  c: pg.Client,
  email: string = emailAlAzar("usuario"),
): Promise<{ id: UsuarioAuthId; email: string }> {
  const { rows } = await c.query<{ id: string }>(
    `insert into autenticacion."user" (name, email, "emailVerified") values ($1, $2, true) returning id`,
    [`Usuario ${email}`, email],
  );
  return { id: usuarioAuthId(rows[0]?.id as string), email };
}

/** Vincula a una persona con un usuario (lo que hace la aceptación de una invitación). */
export async function vincularDeBase(
  c: pg.Client,
  persona: string,
  usuario: UsuarioAuthId,
): Promise<void> {
  await c.query("update persona set usuario_auth_id = $2 where id = $1", [persona, usuario]);
}

/** Una membresía de la persona en la empresa, armada por el dueño (con su rol y su estado). */
async function membresiaDeBase(
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

/** Una persona con su usuario ya vinculado y, si se pide, membresías activas en esas empresas. */
export type PersonaConUsuarioDePrueba = Readonly<{
  persona: string;
  email: string;
  usuario: UsuarioAuthId;
}>;

export async function personaConUsuario(
  c: pg.Client,
  opciones: { activaGlobal?: boolean } = {},
): Promise<PersonaConUsuarioDePrueba> {
  const email = emailAlAzar("vinculada");
  const { rows } = await c.query<{ id: string }>(
    "insert into persona (email, activo_global) values ($1, $2) returning id",
    [email, opciones.activaGlobal ?? true],
  );
  const persona = rows[0]?.id as string;
  const usuario = await crearUsuarioDeBase(c, email);
  await vincularDeBase(c, persona, usuario.id);
  return { persona, email, usuario: usuario.id };
}

/** Una empresa de esa marca con la persona como miembro. */
export async function empresaConMiembro(
  c: pg.Client,
  p: Pick<PersonaConUsuarioDePrueba, "persona">,
  opciones: {
    marca?: MarcaComercialId | string;
    tenant?: string;
    estado?: "ACTIVE" | "PROVISIONING" | "SUSPENDED";
    rol?: RolDePrueba;
    activo?: boolean;
  } = {},
): Promise<MundoDeMarca> {
  const mundo = await crearMundoDeMarca(c, {
    ...(opciones.marca === undefined ? {} : { marca: opciones.marca }),
    ...(opciones.tenant === undefined ? {} : { tenant: opciones.tenant }),
    ...(opciones.estado === undefined ? {} : { estado: opciones.estado }),
  });
  await membresiaDeBase(c, mundo.empresa, p.persona, opciones.rol ?? "OPERADOR", opciones.activo);
  return mundo;
}

/** Una sesión de la aplicación con el contexto SESION de ese usuario (transacción abierta). */
export async function conSesion<T>(
  base: BaseDePruebas,
  usuario: UsuarioAuthId,
  trabajo: (s: SesionDePrueba) => Promise<T>,
): Promise<T> {
  const s = await SesionDePrueba.abrir(base, "pedernal_app", comoSesion(usuario));
  try {
    return await trabajo(s);
  } finally {
    await s.cerrar();
  }
}

/** Una sesión de la aplicación con el contexto de INVITACION (y el usuario que ya ingresó, si lo hay). */
export async function conInvitacion<T>(
  base: BaseDePruebas,
  tokenHash: string,
  usuario: UsuarioAuthId | null,
  trabajo: (s: SesionDePrueba) => Promise<T>,
): Promise<T> {
  const s = await SesionDePrueba.abrir(base, "pedernal_app", comoInvitacion(tokenHash, usuario));
  try {
    return await trabajo(s);
  } finally {
    await s.cerrar();
  }
}

/** Un uuid al azar que no es de ningún usuario ni persona. */
export const uuidAlAzar = (): string => randomUUID();

// ---- la migración y su reversión, sea cual sea su número -------------------------------------------------------

/** Nombre del archivo de la migración de autenticación (el número es provisorio: se renumera al integrar). */
export async function archivoDeAutenticacion(): Promise<string> {
  const archivos = (await readdir(CARPETA_DE_MIGRACIONES)).filter((n) =>
    /^\d{4}_autenticacion\.sql$/.test(n),
  );
  if (archivos.length !== 1) {
    throw new Error(`tenía que haber una migración de autenticación y hay ${archivos.length}`);
  }
  return archivos[0] as string;
}

/** Las migraciones que van ANTES de la de autenticación (todas las de número menor), en orden. */
export async function migracionesPrevias(): Promise<string[]> {
  const mia = await archivoDeAutenticacion();
  return (await readdir(CARPETA_DE_MIGRACIONES))
    .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && n < mia)
    .sort();
}

/** La reversión de la migración de autenticación (también por nombre). */
export async function archivoDeReversionDeAutenticacion(): Promise<string> {
  const archivos = (await readdir(join(CARPETA_DE_MIGRACIONES, "reversiones"))).filter((n) =>
    /^\d{4}_revertir_autenticacion\.sql$/.test(n),
  );
  if (archivos.length !== 1) {
    throw new Error(`tenía que haber una reversión de autenticación y hay ${archivos.length}`);
  }
  return join(CARPETA_DE_MIGRACIONES, "reversiones", archivos[0] as string);
}

/** Una carpeta temporal con las migraciones previas y, si se pide, la de autenticación. */
export async function carpetaConAutenticacion(conAutenticacion: boolean): Promise<string> {
  const previas = await migracionesPrevias();
  return carpetaCon(conAutenticacion ? [...previas, await archivoDeAutenticacion()] : previas);
}
