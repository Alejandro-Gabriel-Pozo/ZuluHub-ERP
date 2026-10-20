import { randomBytes, randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import type pg from "pg";
import { opcionesDeInstancia } from "../../src/adaptadores/autenticacion/opciones";
import { configuracionDeHost } from "../../src/capacidades/autenticacion/host-de-autenticacion";
import { LIMITES_DE_SESION_DE_PLATAFORMA } from "../../src/capacidades/autenticacion/vigencia-de-sesion";
import {
  crearAutenticacionDePlataformaDeBetterAuth,
  type ConfiguracionDeAutenticacionDePlataforma,
} from "../../src/adaptadores/autenticacion/autenticacion-de-better-auth";
import { crearConexionDeAutenticacion } from "../../src/adaptadores/postgres/conexion-de-autenticacion";
import { crearAdminsDePostgres, type AdminsDb } from "../../src/adaptadores/postgres/admins";
import {
  crearAuditoriaDeIngresoDePlataformaDePostgres,
  type TxDeAuditoriaDeIngreso,
} from "../../src/adaptadores/postgres/auditoria-de-ingreso-de-plataforma";
import {
  crearAuditoriaDePlataformaDePostgres,
  type AuditoriaDePlataformaDb,
} from "../../src/adaptadores/postgres/auditoria-de-plataforma";
import { crearPersonalHabilitadoDePostgres } from "../../src/adaptadores/postgres/personal-habilitado";
import {
  crearTransacciones,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import { codigoDeTotp, pasoDeTotp } from "../../src/capacidades/autenticacion/totp";
import type {
  AutenticacionDePlataforma,
  PersonalHabilitado,
} from "../../src/puertos/autenticacion";
import type { AuditoriaDeIngresoDePlataforma } from "../../src/puertos/segundo-factor-de-autenticacion";
import { Navegador, type PerfilDePrueba, type ProveedorLocal } from "./autenticacion-ingreso-apoyo";
import type { BaseDePruebas } from "./global";

/**
 * Apoyo de las pruebas de la consola de plataforma (P8a): la autenticación de plataforma armada sobre la base de la
 * prueba con el personal habilitado REAL (la tabla `admin_plataforma` por la conexión de plataforma), el proveedor
 * de Google local de las pruebas de empresa y un secreto al azar de cada corrida. Ningún valor es real.
 */

export const HOST_DE_LA_CONSOLA = "consola.example.test";
export const HOST_DE_LA_WEB = "app.example.test";

export type PlataformaDePrueba = Readonly<{
  autenticacion: AutenticacionDePlataforma;
  secreto: string;
  conexion: ReturnType<typeof crearConexionDeAutenticacion>;
  transacciones: TransaccionesDePostgres<TxDeAuditoriaDeIngreso>;
  registros: string[];
  cerrar(): Promise<void>;
}>;

export type OpcionesDePlataformaDePrueba = Readonly<{
  reloj?: () => Date;
  relojDeTotp?: () => Date;
  personal?: PersonalHabilitado;
  auditoria?: AuditoriaDeIngresoDePlataforma;
  secreto?: string;
  url?: string;
  capacidadDeLaCache?: number;
  ajustes?: Partial<ConfiguracionDeAutenticacionDePlataforma>;
}>;

export function armarPlataformaDePrueba(
  base: BaseDePruebas,
  proveedor: ProveedorLocal,
  opciones: OpcionesDePlataformaDePrueba = {},
): PlataformaDePrueba {
  const conexion = crearConexionDeAutenticacion({
    url: opciones.url ?? base.autenticacion,
    maximoDeConexiones: 8,
  });
  const transacciones = crearTransacciones<TxDeAuditoriaDeIngreso>({
    urls: { PLATAFORMA: base.plataforma },
    clave: base.clave,
    maximoDeConexiones: 3,
    armar: (db, contexto) => ({
      admins: crearAdminsDePostgres(db.withTables<AdminsDb>()),
      auditoriaDePlataforma: crearAuditoriaDePlataformaDePostgres(
        db.withTables<AuditoriaDePlataformaDb>(),
        contexto,
      ),
    }),
  });
  const secreto = opciones.secreto ?? randomBytes(32).toString("hex");
  const registros: string[] = [];
  const reloj = opciones.reloj;
  const autenticacion = crearAutenticacionDePlataformaDeBetterAuth({
    db: conexion.db,
    secreto,
    google: { clientId: proveedor.clientId, clientSecret: proveedor.clientSecret },
    registrar: (d) => registros.push(d),
    ...(reloj === undefined ? {} : { reloj }),
    ...(opciones.capacidadDeLaCache === undefined
      ? {}
      : { capacidadDeLaCache: opciones.capacidadDeLaCache }),
    consola: {
      personal: opciones.personal ?? crearPersonalHabilitadoDePostgres(transacciones, reloj),
      segundoFactor: conexion.segundoFactor,
      auditoria:
        opciones.auditoria ?? crearAuditoriaDeIngresoDePlataformaDePostgres(transacciones, reloj),
      ...(opciones.relojDeTotp === undefined ? {} : { relojDeTotp: opciones.relojDeTotp }),
    },
    ...opciones.ajustes,
  });
  return {
    autenticacion,
    secreto,
    conexion,
    transacciones,
    registros,
    cerrar: async () => {
      await conexion.cerrar();
      await transacciones.cerrar();
    },
  };
}

export type AdminDePrueba = PerfilDePrueba & Readonly<{ adminId: string }>;

/** Da de alta a un administrador de plataforma (lo hace el dueño con su conexión: ningún rol limitado puede). */
export async function altaDeAdmin(
  dueno: pg.Client,
  opciones: { rol?: "ADMIN" | "SOPORTE"; activo?: boolean } = {},
): Promise<AdminDePrueba> {
  const email = `admin-${randomUUID().slice(0, 8)}@ejemplo.test`;
  const { rows } = await dueno.query<{ id: string }>(
    `insert into admin_plataforma (email, rol, activo) values ($1, $2, $3) returning id`,
    [email, opciones.rol ?? "ADMIN", opciones.activo ?? true],
  );
  return {
    sub: `sub-${randomUUID()}`,
    email,
    emailVerificado: true,
    nombre: "Admin de prueba",
    adminId: rows[0]?.id as string,
  };
}

const ALFABETO_BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** El secreto que la aplicación autenticadora decodifica del base32 de la dirección: los bytes que usa el HMAC. */
export function decodificarBase32(texto: string): string {
  let bits = "";
  for (const c of texto.replace(/=+$/, "")) {
    const valor = ALFABETO_BASE32.indexOf(c);
    if (valor < 0) throw new Error("base32 inválido");
    bits += valor.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes).toString("utf8");
}

/** El código TOTP que mostraría la aplicación autenticadora para ese secreto (base32) en ese instante (por omisión, ahora). */
export const codigoDeLaAplicacion = (
  secretoBase32: string,
  instante: Date = new Date(),
  desvioEnPasos = 0,
): string => codigoDeTotp(decodificarBase32(secretoBase32), pasoDeTotp(instante) + desvioEnPasos);

/** Un navegador nuevo (otra IP) con las mismas cookies que `n` en `host`: otro «dispositivo» con la misma sesión. */
export function otroNavegadorConLaSesion(n: Navegador, host: string): Navegador {
  const otro = new Navegador();
  n.copiarCookiesA(otro, host, host);
  return otro;
}

/**
 * La instancia de la librería de la consola SIN pasar por `manejar` (el cierre real de las rutas): sirve para llamar
 * a `auth.api.*` y probar que las barreras de los ganchos (G3) valen aunque alguien abra una ruta que hoy está cerrada.
 * Misma base, mismo secreto: reconoce las cookies de `p`.
 */
export function instanciaDirectaDeLaConsola(
  p: PlataformaDePrueba,
  proveedor: ProveedorLocal,
  host: string = HOST_DE_LA_CONSOLA,
) {
  const c = configuracionDeHost(host);
  if (!c.ok) throw new Error("host de prueba inválido");
  const auth = betterAuth(
    opcionesDeInstancia({
      audiencia: "PLATAFORMA",
      consola: {
        personal: { esHabilitado: () => Promise.resolve(true) },
        segundoFactor: p.conexion.segundoFactor,
        auditoria: { registrarBloqueoDeSegundoFactor: () => Promise.resolve() },
      },
      configuracion: c.valor,
      db: p.conexion.db,
      secreto: p.secreto,
      google: { clientId: proveedor.clientId, clientSecret: proveedor.clientSecret },
      limites: LIMITES_DE_SESION_DE_PLATAFORMA,
      reloj: () => new Date(),
      rutaDeError: "/ingreso",
      registrar: () => undefined,
    }),
  );
  return auth.api as unknown as Record<
    string,
    (entrada: { headers: Headers; body?: unknown }) => Promise<unknown>
  >;
}
