import { createHmac } from "node:crypto";
import pg from "pg";
import type { Contexto, TipoDeContexto } from "../../contexto/contexto";
import { ErrorDeConfiguracion } from "./errores";

/**
 * Contexto firmado (ADR-011, endurecido en H2).
 *
 * El servidor ya no fija `app.empresa_id` & co. (variables de usuario que cualquier rol limitado
 * puede pisar con `set_config`): firma un token con una clave que solo conocen el servidor y la
 * base, y lo fija como única variable `app.ctx`. La función `contexto_firmado()` de la migración
 * 0001 lo verifica y de ahí leen las políticas. Formato:
 *
 *     v1.<kid>.<payloadHex>.<macHex>
 *
 * - `payloadHex`: hex del JSON UTF-8 `{u, e, t, p, i, x}` (claves cortas, siempre en ese orden).
 * - `macHex`: HMAC-SHA256 hex del texto `v1.<kid>.<payloadHex>` con el secreto de la clave `kid`.
 */

/** NOMBRE de la variable de entorno con la clave (`<kid>:<hex>`). El valor lo carga el dueño. */
export const ZULUHUB_CLAVE_CONTEXTO = "ZULUHUB_CLAVE_CONTEXTO";

/** Cuánto vale un token desde que se firma. Se firma de nuevo en cada intento de una transacción. */
export const VIGENCIA_DEL_CONTEXTO_EN_S = 300;

const KID_MAXIMO = 32767; // smallint
const HEX_MINIMO = 64; // 32 bytes

export type ClaveDeContexto = Readonly<{ kid: number; secreto: Buffer }>;

export type RolDeContexto =
  "zuluhub_app" | "zuluhub_grupo" | "zuluhub_trabajos" | "zuluhub_plataforma";

/** Lo que lleva el token firmado. `u` es el rol con el que el cliente abre la sesión de base. */
export type CargaDeContexto = Readonly<{
  u: string;
  e: string | null;
  t: string | null;
  p: string | null;
  i: string | null;
  x: number;
}>;

/** Rol de base de cada puerta. La invitación entra por el rol de la aplicación. */
export function rolDeContexto(tipo: TipoDeContexto): RolDeContexto {
  switch (tipo) {
    case "OPERATIVO":
    case "INVITACION":
      return "zuluhub_app";
    case "GRUPO":
      return "zuluhub_grupo";
    case "TRABAJOS":
      return "zuluhub_trabajos";
    case "PLATAFORMA":
      return "zuluhub_plataforma";
  }
}

/**
 * Parsea `<kid>:<hex>` (hex de al menos 64 caracteres = 32 bytes, cantidad par). Recibe el valor de
 * la variable `ZULUHUB_CLAVE_CONTEXTO`; no lee `process.env`. Si falta o es inválido lanza
 * `ErrorDeConfiguracion` con un mensaje que NUNCA incluye el valor recibido.
 */
export function leerClaveDeContexto(valor: string | undefined): ClaveDeContexto {
  const invalida = (motivo: string) =>
    new ErrorDeConfiguracion(
      `${ZULUHUB_CLAVE_CONTEXTO} inválida: ${motivo} (formato esperado: <kid>:<hex de 64 o más dígitos>)`,
    );
  const texto = valor?.trim() ?? "";
  if (texto === "") throw invalida("falta");
  const partes = texto.split(":");
  if (partes.length !== 2) throw invalida("no tiene la forma <kid>:<hex>");
  const [kidTexto, hex] = partes as [string, string];
  if (!/^[1-9][0-9]{0,4}$/.test(kidTexto) || Number(kidTexto) > KID_MAXIMO) {
    throw invalida(`el kid debe ser un entero entre 1 y ${KID_MAXIMO}`);
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) throw invalida("el secreto no es hexadecimal");
  if (hex.length % 2 !== 0) throw invalida("el secreto tiene una cantidad impar de dígitos");
  if (hex.length < HEX_MINIMO) throw invalida(`el secreto necesita al menos ${HEX_MINIMO} dígitos`);
  return { kid: Number(kidTexto), secreto: Buffer.from(hex, "hex") };
}

/** Firma una carga ya armada. Es la primitiva; el servidor usa `firmarContexto`. */
export function firmarCarga(clave: ClaveDeContexto, carga: CargaDeContexto): string {
  // Orden fijo de claves: el mismo contexto produce siempre el mismo token (y se puede fijar un vector).
  const json = JSON.stringify({
    u: carga.u,
    e: carga.e,
    t: carga.t,
    p: carga.p,
    i: carga.i,
    x: carga.x,
  });
  const cuerpo = `v1.${clave.kid}.${Buffer.from(json, "utf8").toString("hex")}`;
  const mac = createHmac("sha256", clave.secreto).update(cuerpo, "utf8").digest("hex");
  return `${cuerpo}.${mac}`;
}

/** Qué campos lleva cada puerta. */
function cargaDe(contexto: Contexto, vence: number): CargaDeContexto {
  const u = rolDeContexto(contexto.tipo);
  switch (contexto.tipo) {
    case "OPERATIVO":
      return { u, e: contexto.empresaId, t: null, p: contexto.personaId, i: null, x: vence };
    case "GRUPO":
      return { u, e: null, t: contexto.tenantId, p: contexto.personaId, i: null, x: vence };
    case "INVITACION":
      return { u, e: null, t: null, p: null, i: contexto.tokenHash, x: vence };
    case "PLATAFORMA":
    case "TRABAJOS":
      return { u, e: null, t: null, p: null, i: null, x: vence };
  }
}

/**
 * Firma el contexto de una transacción. `ahoraEnSegundos` es el RELOJ REAL del servidor (el
 * adaptador pasa `Math.floor(Date.now() / 1000)`), no `contexto.ahora`, que es un dato de negocio.
 */
export function firmarContexto(
  clave: ClaveDeContexto,
  contexto: Contexto,
  ahoraEnSegundos: number,
): string {
  if (contexto.tipo === "INVITACION" && !/^[0-9a-f]{64}$/.test(contexto.tokenHash)) {
    throw new RangeError("tokenHash debe ser un sha256 en hexadecimal minúsculo (64 caracteres)");
  }
  return firmarCarga(clave, cargaDe(contexto, ahoraEnSegundos + VIGENCIA_DEL_CONTEXTO_EN_S));
}

/**
 * Instala la clave en `contexto_clave` (operación y pruebas; la conexión es la del DUEÑO de la base:
 * ningún rol limitado puede tocar esa tabla). Idempotente si el `kid` ya existe con el mismo
 * secreto. Falla si existe con OTRO secreto (la rotación se hace con otro `kid`) o si esa clave fue
 * revocada. Los valores viajan como parámetros y ningún mensaje de error incluye el secreto.
 */
export async function instalarClaveDeContexto(
  urlDueno: string,
  clave: ClaveDeContexto,
): Promise<void> {
  const hex = clave.secreto.toString("hex");
  const cliente = new pg.Client({ connectionString: urlDueno });
  await cliente.connect();
  try {
    await cliente.query(
      "INSERT INTO contexto_clave (kid, secreto) VALUES ($1, decode($2, 'hex')) ON CONFLICT (kid) DO NOTHING",
      [clave.kid, hex],
    );
    const { rows } = await cliente.query<{ igual: boolean; vigente: boolean }>(
      "SELECT secreto = decode($2, 'hex') AS igual, vigente FROM contexto_clave WHERE kid = $1",
      [clave.kid, hex],
    );
    const fila = rows[0];
    if (fila === undefined) {
      throw new ErrorDeConfiguracion(`no se pudo instalar la clave de contexto kid ${clave.kid}`);
    }
    if (!fila.igual) {
      throw new ErrorDeConfiguracion(
        `ya existe la clave de contexto kid ${clave.kid} con otro secreto: la rotación se hace con otro kid`,
      );
    }
    if (!fila.vigente) {
      throw new ErrorDeConfiguracion(`la clave de contexto kid ${clave.kid} está revocada`);
    }
  } finally {
    await cliente.end();
  }
}
