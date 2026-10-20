import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { instalarClaveDeContexto } from "../../src/adaptadores/postgres/contexto-firmado";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { ADMIN_DE_PRUEBA, sembrarAdminsDePrueba } from "./admins-de-prueba";
import { AHORA_DE_PRUEBA, crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import {
  ARCHIVO_0007,
  CARPETA_DE_MIGRACIONES,
  HASTA_0006,
  carpetaCon,
  crearMundoDeMarca,
  marcaPrincipal,
} from "./marcas-apoyo";
import { SesionDePrueba } from "./sesiones";
import type { EstadoDeSolicitud } from "../../src/plataforma/captacion/dominio/estados";

/**
 * Apoyo de las pruebas de la migración de captación (alta por solicitud, L1). Todo el armado de escenarios
 * lo hace el cliente del DUEÑO de la base (evade RLS); lo que se prueba después se hace con el rol real
 * (`pedernal_captacion`, `pedernal_plataforma`...) y su contexto firmado.
 *
 * El número de la migración es PROVISORIO (se renumera al integrar): nada acá lo escribe. El archivo se
 * encuentra por su nombre (`*_captacion.sql`).
 */

export { CARPETA_DE_MIGRACIONES };

/** Las migraciones anteriores a la de captación, en orden. */
export const HASTA_0007 = [...HASTA_0006, ARCHIVO_0007] as const;

/** Nombre del archivo de la migración de captación, sea cual sea su número. */
export async function archivoDeCaptacion(): Promise<string> {
  const archivos = (await readdir(CARPETA_DE_MIGRACIONES)).filter((n) =>
    /^\d{4}_captacion\.sql$/.test(n),
  );
  if (archivos.length !== 1) {
    throw new Error(`tenía que haber una migración de captación y hay ${archivos.length}`);
  }
  return archivos[0] as string;
}

/** La reversión de la migración de captación (también por nombre). */
export async function archivoDeReversionDeCaptacion(): Promise<string> {
  const archivos = (await readdir(join(CARPETA_DE_MIGRACIONES, "reversiones"))).filter((n) =>
    /^\d{4}_revertir_captacion\.sql$/.test(n),
  );
  if (archivos.length !== 1) {
    throw new Error(`tenía que haber una reversión de captación y hay ${archivos.length}`);
  }
  return join(CARPETA_DE_MIGRACIONES, "reversiones", archivos[0] as string);
}

/** Una carpeta temporal con las migraciones dadas y, si se pide, también la de captación. */
export async function carpetaConCaptacion(
  hasta: readonly string[],
  conCaptacion: boolean,
): Promise<string> {
  return carpetaCon(conCaptacion ? [...hasta, await archivoDeCaptacion()] : hasta);
}

// ---- el contexto firmado de la landing -------------------------------------------------------------------

/** Lo que el servidor firma en el claim `c`: una solicitud por id, o una marca y un correo. */
export type ClaimDeCaptacion = Readonly<{
  /** La solicitud por su id (verificar el correo, los manejadores de los trabajos). */
  s?: string;
  /** Una marca y un correo (crear, reenviar). Sin `s`, `m` y `e` juntos; `{}` es el contexto de los contadores. */
  m?: string;
  e?: string;
}>;

type CargaConClaim = Readonly<{
  u: string;
  e: null;
  t: null;
  p: null;
  i: null;
  x: number;
  a: string | null;
  c: unknown;
}>;

/**
 * Firma el contexto de la landing con el formato de `contexto_firmado()` (`v1.<kid>.<payloadHex>.<macHex>`).
 * Es el mismo formato que `firmarCarga` de producción; este ayudante existe porque esa función todavía no
 * sabe escribir el claim `c` (lo suma el tramo L2, con su vector fijo): cuando lo haga, esto se reemplaza
 * por ella. El orden de las claves es el de siempre y `c` va al final.
 */
export function firmarCargaDeCaptacion(
  base: BaseDePruebas,
  carga: Partial<CargaConClaim> & Pick<CargaConClaim, "c">,
  opciones: { secreto?: Buffer } = {},
): string {
  const completa: CargaConClaim = {
    u: "pedernal_captacion",
    e: null,
    t: null,
    p: null,
    i: null,
    x: Math.floor(Date.now() / 1000) + 300,
    a: null,
    ...carga,
  };
  const json = JSON.stringify({
    u: completa.u,
    e: completa.e,
    t: completa.t,
    p: completa.p,
    i: completa.i,
    x: completa.x,
    a: completa.a,
    c: completa.c,
  });
  const cuerpo = `v1.${base.clave.kid}.${Buffer.from(json, "utf8").toString("hex")}`;
  const mac = createHmac("sha256", opciones.secreto ?? base.clave.secreto)
    .update(cuerpo, "utf8")
    .digest("hex");
  return `${cuerpo}.${mac}`;
}

const firmarCaptacion = (base: BaseDePruebas, claim: ClaimDeCaptacion): string =>
  firmarCargaDeCaptacion(base, { c: claim });

/** Una sesión con el rol de la landing y ese contexto (transacción abierta). */
export async function sesionDeCaptacion(
  base: BaseDePruebas,
  claim: ClaimDeCaptacion | null,
  aislamiento: "read committed" | "repeatable read" | "serializable" = "read committed",
): Promise<SesionDePrueba> {
  return SesionDePrueba.abrirConToken(
    base,
    "pedernal_captacion",
    claim === null ? null : firmarCaptacion(base, claim),
    aislamiento,
  );
}

export async function conCaptacion<T>(
  base: BaseDePruebas,
  claim: ClaimDeCaptacion | null,
  trabajo: (s: SesionDePrueba) => Promise<T>,
): Promise<T> {
  const s = await sesionDeCaptacion(base, claim);
  try {
    return await trabajo(s);
  } finally {
    await s.cerrar();
  }
}

// ---- solicitudes de prueba ---------------------------------------------------------------------------------

export type SolicitudDePrueba = Readonly<{
  id: string;
  marca: string;
  email: string;
  estado: EstadoDeSolicitud;
}>;

export type OpcionesDeSolicitud = Readonly<{
  estado?: EstadoDeSolicitud;
  marca?: string;
  email?: string;
  /** Cuándo se recibió (por defecto, el `ahora` de las pruebas). */
  creadaEn?: Date;
  medicionConsentida?: boolean;
  atribucion?: Record<string, string>;
  telefono?: string | null;
  cuit?: string | null;
  motivo?: string;
  decididaPor?: string;
  decididaEn?: Date;
  numeroDeEnvios?: number;
  ultimoEnvioEn?: Date;
  nota?: string | null;
  /** Para `ALTA_CREADA`: la empresa creada (por defecto se arma una). */
  empresaCreadaId?: string;
}>;

export const emailAlAzar = (): string => `s${randomBytes(6).toString("hex")}@prueba.test`;

/**
 * Una solicitud en el estado pedido, con todos sus datos coherentes. La inserta el DUEÑO, que puede
 * dejarla directamente en cualquier estado (no pasa por las transiciones: eso lo prueban otros casos).
 */
export async function crearSolicitud(
  c: pg.Client,
  opciones: OpcionesDeSolicitud = {},
): Promise<SolicitudDePrueba> {
  const estado = opciones.estado ?? "NUEVA";
  const marca = opciones.marca ?? (await marcaPrincipal(c));
  const email = opciones.email ?? emailAlAzar();
  const creada = opciones.creadaEn ?? AHORA_DE_PRUEBA;
  const decidida = opciones.decididaEn ?? new Date(creada.getTime() + 3_600_000);
  const verificada = new Date(creada.getTime() + 60_000);
  const verificadaEn = ["VERIFICADA", "APROBADA", "ALTA_CREADA"].includes(estado)
    ? verificada
    : null;
  const decidirPorAdmin = ["APROBADA", "ALTA_CREADA", "RECHAZADA", "SPAM"].includes(estado);
  const motivo = estado === "RECHAZADA" ? (opciones.motivo ?? "OTRO") : null;
  const empresaCreada =
    estado === "ALTA_CREADA"
      ? (opciones.empresaCreadaId ?? (await crearMundoDeMarca(c, { marca })).empresa)
      : null;
  const consent = opciones.medicionConsentida ?? false;
  const { rows } = await c.query<{ id: string }>(
    `insert into solicitud_de_alta
       (marca_id, estado, email, nombre_contacto, nombre_negocio, telefono, cuit, id_de_medicion, nota_interna,
        rubro, provincia, atribucion, version_de_terminos, version_de_privacidad, medicion_consentida,
        version_de_aviso_de_medicion, numero_de_envios, ultimo_envio_en, verificada_en, decidida_por,
        decidida_en, motivo_de_rechazo, empresa_creada_id, creada_en)
     values ($1, $2, $3, 'Ana Pérez', 'Café Central', $4, $5, $6, $7, 'cafeteria', 'AR-B', $8::jsonb,
             '2026-10-13', '2026-10-13.1', $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     returning id`,
    [
      marca,
      estado,
      email,
      opciones.telefono === undefined ? "+5491112345678" : opciones.telefono,
      opciones.cuit === undefined ? "30703088534" : opciones.cuit,
      consent ? randomUUID() : null,
      opciones.nota === undefined ? null : opciones.nota,
      JSON.stringify(opciones.atribucion ?? { utm_source: "meta", utm_campaign: "verano" }),
      consent,
      consent ? "2026-11-01" : null,
      opciones.numeroDeEnvios ?? 1,
      opciones.ultimoEnvioEn ?? creada,
      verificadaEn,
      decidirPorAdmin ? (opciones.decididaPor ?? ADMIN_DE_PRUEBA) : null,
      decidirPorAdmin ? decidida : null,
      motivo,
      empresaCreada,
      creada,
    ],
  );
  return { id: (rows[0] as { id: string }).id, marca, email, estado };
}

/** La fila entera tal como está, vista por el dueño. */
export async function filaDe(c: pg.Client, id: string): Promise<Record<string, unknown>> {
  const { rows } = await c.query("select * from solicitud_de_alta where id = $1", [id]);
  return (rows[0] ?? {}) as Record<string, unknown>;
}

/** Cuántas filas hay en una tabla (para «no escribió nada»). */
export async function contar(c: pg.Client, tabla: string, donde = "true"): Promise<number> {
  const { rows } = await c.query<{ n: number }>(
    `select count(*)::int as n from ${tabla} where ${donde}`,
  );
  return rows[0]?.n ?? 0;
}

// ---- bases con las migraciones hasta 0007 y la de captación -----------------------------------------------

/**
 * Una base aparte con 0001 a 0007 y, si se pide, la de captación, más la clave de contexto, los
 * administradores de prueba y la marca de prueba. Con LOGIN para los siete roles, igual que la compartida
 * (los roles son del clúster y ya los tiene).
 */
export async function baseConCaptacion(base: BaseDePruebas, conCaptacion = true) {
  const aparte = await crearBaseAparte(base, { migrar: false });
  const carpeta = await carpetaConCaptacion(HASTA_0007, conCaptacion);
  await aplicarMigraciones(aparte.base.dueno, carpeta);
  await instalarClaveDeContexto(aparte.base.dueno, base.clave);
  await sembrarAdminsDePrueba(aparte.base.dueno);
  const cliente = new pg.Client({ connectionString: aparte.base.dueno });
  await cliente.connect();
  return {
    aparte,
    cliente,
    carpeta,
    cerrar: async () => {
      await cliente.end().catch(() => undefined);
      await rm(carpeta, { recursive: true, force: true });
      await aparte.destruir();
    },
  };
}
