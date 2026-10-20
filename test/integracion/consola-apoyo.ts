import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect } from "vitest";
import {
  armarPuertaDeConsola,
  type AccesoDeConsola,
  type PuertaDeConsola,
} from "../../src/composicion/puerta-de-consola";
import type { SesionAutenticada } from "../../src/puertos/autenticacion";
import {
  Navegador,
  armarAutenticacionDePrueba,
  levantarProveedorLocal,
  type AutenticacionDePrueba,
  type ProveedorLocal,
} from "./autenticacion-ingreso-apoyo";
import {
  HOST_DE_LA_CONSOLA,
  HOST_DE_LA_WEB,
  altaDeAdmin,
  armarPlataformaDePrueba,
  codigoDeLaAplicacion,
  type AdminDePrueba,
  type PlataformaDePrueba,
} from "./autenticacion-plataforma-apoyo";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";

/**
 * Apoyo de las pruebas de la puerta de la consola (P8b), contra una base real y la autenticación REAL de plataforma:
 * un ingreso con Google (proveedor local), el enrolamiento y la verificación del segundo factor por las rutas de
 * verdad, y la puerta de la consola (`armarPuertaDeConsola`) armada sobre la base de la prueba con las variables del
 * entorno de esa corrida (todas de juguete, al azar).
 */

export { HOST_DE_LA_CONSOLA, HOST_DE_LA_WEB };

export type Mundo = Readonly<{
  base: BaseDePruebas;
  destruir: () => Promise<void>;
  dueno: pg.Client;
  proveedor: ProveedorLocal;
  /** La autenticación de la consola (host `HOST_DE_LA_CONSOLA`). */
  consola: PlataformaDePrueba;
  /** La autenticación de la web de empresa (host `HOST_DE_LA_WEB`): otra audiencia, otro secreto, otras cookies. */
  web: AutenticacionDePrueba;
  /** La puerta de la consola con la que se ejecuta todo (reloj real). */
  puerta: PuertaDeConsola;
  entorno: Readonly<Record<string, string>>;
  /** Todo lo que la puerta y la autenticación mandaron al registro del servidor. */
  registros: string[];
  cerrar: () => Promise<void>;
}>;

/** Arma el mundo de una prueba: base propia migrada, autenticación de la consola y de la web, y la puerta. */
export async function armarMundo(base: BaseDePruebas): Promise<Mundo> {
  const proveedor = await levantarProveedorLocal();
  const propia = await crearBaseAparte(base);
  const dueno = new pg.Client({ connectionString: propia.base.dueno });
  await dueno.connect();
  const consola = armarPlataformaDePrueba(propia.base, proveedor);
  const web = armarAutenticacionDePrueba(propia.base, proveedor);
  const registros: string[] = [];
  const entorno = {
    ZULUHUB_DB_PLATAFORMA: propia.base.plataforma,
    ZULUHUB_CLAVE_CONTEXTO: `${base.clave.kid}:${base.clave.secreto.toString("hex")}`,
    ZULUHUB_SECRETO_INVITACIONES: randomBytes(32).toString("hex"),
  };
  const puerta = armarPuertaDeConsola({
    fuente: () => entorno,
    registrar: (d) => registros.push(d),
    hostDeLaConsola: HOST_DE_LA_CONSOLA,
  });
  return {
    base: propia.base,
    destruir: propia.destruir,
    dueno,
    proveedor,
    consola,
    web,
    puerta,
    entorno,
    registros,
    cerrar: async () => {
      expect(proveedor.intentosExternos(), "nada salió a internet").toEqual([]);
      await puerta.cerrar();
      await consola.cerrar();
      await web.cerrar();
      await dueno.end();
      await propia.destruir();
      await proveedor.cerrar();
    },
  };
}

export type Alta = Readonly<{ qrSvg: string; secreto: string; codigosDeRecuperacion: string[] }>;

/** Un administrador de plataforma activo, sembrado como lo hace el dueño. */
export const nuevoAdmin = (m: Mundo, rol: "ADMIN" | "SOPORTE" = "ADMIN"): Promise<AdminDePrueba> =>
  altaDeAdmin(m.dueno, { rol });

/** El ingreso con Google a la consola: un navegador con la sesión (todavía SIN segundo factor). */
export async function ingresar(m: Mundo, admin: AdminDePrueba): Promise<Navegador> {
  const n = new Navegador();
  const r = await n.ingresarConGoogle(
    m.consola.autenticacion,
    HOST_DE_LA_CONSOLA,
    m.proveedor,
    admin,
  );
  expect(r.ubicacion).toBe("/");
  return n;
}

export const pedir = (
  m: Mundo,
  n: Navegador,
  metodo: "GET" | "POST",
  ruta: string,
  cuerpo?: unknown,
) =>
  n.pedir(
    m.consola.autenticacion,
    HOST_DE_LA_CONSOLA,
    metodo,
    ruta,
    cuerpo === undefined ? {} : { cuerpo },
  );

/** Enrola el TOTP y verifica el primer código: deja la sesión CON segundo factor. */
export async function enrolarYVerificar(m: Mundo, n: Navegador): Promise<Alta> {
  const alta = (await pedir(m, n, "POST", "/api/auth/two-factor/enable", {})).json() as Alta;
  const r = await pedir(m, n, "POST", "/api/auth/two-factor/verify-totp", {
    code: codigoDeLaAplicacion(alta.secreto),
  });
  expect(r.estado).toBe(200);
  return alta;
}

/** Un administrador que ingresó, enroló y verificó su segundo factor: la sesión completa. */
export async function adminConSesionCompleta(m: Mundo, rol: "ADMIN" | "SOPORTE" = "ADMIN") {
  const admin = await nuevoAdmin(m, rol);
  const n = await ingresar(m, admin);
  const alta = await enrolarYVerificar(m, n);
  return { admin, n, alta };
}

/** Lo que `sesionDe` de la consola dice de este navegador ahora. */
export const sesionDeLaConsola = (m: Mundo, n: Navegador): Promise<SesionAutenticada | null> =>
  m.consola.autenticacion.sesionDe(n.pedidoDe(HOST_DE_LA_CONSOLA), HOST_DE_LA_CONSOLA);

/** El camino de verdad de la consola: la sesión del pedido y, con ella, la puerta. */
export async function accesoDe(m: Mundo, n: Navegador) {
  return m.puerta.conSesion(await sesionDeLaConsola(m, n));
}

export async function accesoOk(m: Mundo, n: Navegador): Promise<AccesoDeConsola> {
  const r = await accesoDe(m, n);
  if (!r.ok) throw new Error(`tenía que dar acceso y dio ${r.error}`);
  return r.valor;
}

/** Hace que el segundo factor de TODAS las sesiones del administrador haya sido hace `ms` milisegundos. */
export async function envejecerElSegundoFactor(
  m: Mundo,
  admin: AdminDePrueba,
  ms: number,
): Promise<void> {
  await m.dueno.query(
    `update autenticacion.session set segundo_factor_en = now() - ($2 || ' milliseconds')::interval
      where segundo_factor_en is not null
        and "userId" in (select id from autenticacion."user" where email = $1)`,
    [admin.email, String(ms)],
  );
}

export const sesionesDe = async (m: Mundo, email: string): Promise<number> =>
  Number(
    (
      await m.dueno.query<{ n: string }>(
        `select count(*) as n from autenticacion.session s
           join autenticacion."user" u on u.id = s."userId" where u.email = $1`,
        [email],
      )
    ).rows[0]?.n,
  );

export const MINUTO = 60_000;
