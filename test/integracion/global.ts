import { randomBytes } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import type { TestProject } from "vitest/node";
import {
  instalarClaveDeContexto,
  type ClaveDeContexto,
} from "../../src/adaptadores/postgres/contexto-firmado";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";

/**
 * Base compartida de las pruebas de integración: se crea una base descartable, se migra, se les da
 * LOGIN a los cuatro roles con contraseñas al azar de esta corrida, y se borra al terminar.
 *
 * Variable: PRUEBAS_DATABASE_URL = cadena de un rol con permiso para crear bases y roles (por
 * ejemplo, un Postgres local o el servicio del CI). El valor no está en el repositorio.
 * Sin la variable las pruebas de integración se saltean, salvo en el CI, donde faltar es un error.
 */

export type BaseDePruebas = Readonly<{
  /** Cadena del administrador del servidor (crear bases descartables para pruebas que cambian la instalación). */
  admin: string;
  /** Cadena del dueño de la base (migraciones y preparación de datos). */
  dueno: string;
  app: string;
  grupo: string;
  trabajos: string;
  plataforma: string;
  /** Clave de firma del contexto de ESTA corrida (kid 1), instalada en la base con `dueno`. */
  clave: ClaveDeContexto;
}>;

declare module "vitest" {
  export interface ProvidedContext {
    baseDePruebas: BaseDePruebas | null;
  }
}

const ROLES = ["app", "grupo", "trabajos", "plataforma"] as const;

function conBase(url: string, base: string): string {
  const u = new URL(url);
  u.pathname = `/${base}`;
  return u.toString();
}

function conUsuario(url: string, usuario: string, clave: string): string {
  const u = new URL(url);
  u.username = usuario;
  u.password = clave;
  return u.toString();
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const urlAdmin = process.env["PRUEBAS_DATABASE_URL"];
  // La mutación corre solo las pruebas sin base: lo indica con esta variable.
  if (process.env["ZULUHUB_SIN_INTEGRACION"] === "1") {
    project.provide("baseDePruebas", null);
    return () => Promise.resolve();
  }
  if (urlAdmin === undefined || urlAdmin === "") {
    if (process.env["CI"] === "true") {
      throw new Error(
        "En el CI falta PRUEBAS_DATABASE_URL: las pruebas de integración no pueden saltearse.",
      );
    }
    project.provide("baseDePruebas", null);
    return () => Promise.resolve();
  }

  const nombre = `zuluhub_it_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: urlAdmin });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${nombre}`);

  const urlDueno = conBase(urlAdmin, nombre);
  await aplicarMigraciones(urlDueno, join(import.meta.dirname, "../../migraciones"));

  // Clave de contexto al azar por corrida: nunca se repite ni se escribe en el repositorio.
  const claveDeContexto: ClaveDeContexto = { kid: 1, secreto: randomBytes(32) };
  await instalarClaveDeContexto(urlDueno, claveDeContexto);

  const claves = Object.fromEntries(ROLES.map((r) => [r, randomBytes(18).toString("hex")]));
  for (const rol of ROLES) {
    await admin.query(`ALTER ROLE zuluhub_${rol} LOGIN PASSWORD '${claves[rol]}'`);
  }
  const url = (rol: (typeof ROLES)[number]) =>
    conUsuario(urlDueno, `zuluhub_${rol}`, claves[rol] as string);

  project.provide("baseDePruebas", {
    admin: urlAdmin,
    dueno: urlDueno,
    app: url("app"),
    grupo: url("grupo"),
    trabajos: url("trabajos"),
    plataforma: url("plataforma"),
    clave: claveDeContexto,
  });

  return async () => {
    for (const rol of ROLES) await admin.query(`ALTER ROLE zuluhub_${rol} NOLOGIN`);
    await admin.query(`DROP DATABASE ${nombre} WITH (FORCE)`);
    await admin.end();
  };
}
