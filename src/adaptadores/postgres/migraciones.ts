import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

/**
 * Aplica en orden los archivos `NNNN_nombre.sql` de la carpeta de migraciones, cada uno en su propia
 * transacción, y deja registro con el checksum. Una migración ya aplicada que se editó después
 * rompe con un error: el historial no se reescribe, se agrega una migración nueva.
 *
 * Usa la cadena DIRECTA de la base (no la del pooler): las migraciones toman un bloqueo de sesión
 * que detrás de PgBouncer no protege nada, y por eso una cadena con pooler se rechaza.
 *
 * Reglas del ejecutor:
 * - Cada archivo corre dentro de la transacción del ejecutor: no puede traer su propio
 *   BEGIN/COMMIT/ROLLBACK (si lo trajera, el registro en `migracion` quedaría fuera de la
 *   transacción y una falla dejaría la migración aplicada a medias).
 * - La sesión fija `lock_timeout` y `statement_timeout`: una migración que necesita un bloqueo que
 *   otra sesión no suelta falla en vez de hacer cola detrás de ella y frenar toda la aplicación.
 * - El checksum se calcula sobre el contenido con fin de línea LF: un checkout en Windows (CRLF) no
 *   hace pasar por editada una migración ya aplicada.
 * - Si la tabla `migracion` tiene una migración cuyo archivo ya no está, se rechaza: borrar un
 *   archivo del historial es reescribirlo.
 */

/** Compartido con `estado-de-migraciones.ts` (solo lectura): una sola definición de qué es una migración. */
export const PATRON_DE_ARCHIVO = /^(\d{4})_[a-z0-9_]+\.sql$/;
const CLAVE_DE_BLOQUEO = 7_340_001;
const ESPERA_DE_BLOQUEO_POR_DEFECTO_EN_MS = 10_000;
const DURACION_MAXIMA_POR_DEFECTO_EN_MS = 5 * 60_000;

export class ErrorDeMigracion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeMigracion";
  }
}

export type ResultadoDeMigraciones = Readonly<{ aplicadas: string[]; yaAplicadas: string[] }>;

export type OpcionesDeMigraciones = Readonly<{
  /** Cuánto espera una sentencia por un bloqueo ajeno antes de fallar. Por defecto 10 s. */
  esperaDeBloqueoEnMs?: number;
  /** Duración máxima de cada sentencia de una migración. Por defecto 5 min. */
  duracionMaximaEnMs?: number;
}>;

/** Compartido con `estado-de-migraciones.ts`: una sola definición de qué cadena es del pooler. */
export function hostConPooler(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    // Cadena que no se deja leer como URL: mejor rechazar que arriesgar el bloqueo de sesión.
    host = url;
  }
  return host.toLowerCase().includes("-pooler");
}

function milisegundosValidos(valor: number, nombre: string): number {
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new RangeError(`${nombre} debe ser un entero positivo de milisegundos (llegó ${valor})`);
  }
  return valor;
}

/**
 * Devuelve el SQL sin comentarios, literales de texto, identificadores entre comillas ni bloques
 * entre `$$ ... $$` (cuerpos de funciones y bloques DO), conservando los `;` que separan
 * sentencias. Sirve para mirar solo la estructura de las sentencias.
 */
function soloEstructura(sql: string): string {
  let salida = "";
  let i = 0;
  const esLetraDeIdentificador = (c: string | undefined) =>
    c !== undefined && /[\w$\u0080-￿]/.test(c);
  while (i < sql.length) {
    const c = sql[i] as string;
    const siguiente = sql[i + 1];
    if (c === "-" && siguiente === "-") {
      const fin = sql.indexOf("\n", i);
      i = fin === -1 ? sql.length : fin;
    } else if (c === "/" && siguiente === "*") {
      let profundidad = 1;
      i += 2;
      while (i < sql.length && profundidad > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          profundidad += 1;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          profundidad -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      salida += " ";
    } else if (c === "'" || c === '"') {
      // En una cadena E'...' la barra invertida escapa; en las demás solo se duplica la comilla.
      const conEscapes =
        c === "'" && /[eE]/.test(sql[i - 1] ?? "") && !esLetraDeIdentificador(sql[i - 2]);
      i += 1;
      while (i < sql.length) {
        if (conEscapes && sql[i] === "\\") {
          i += 2;
        } else if (sql[i] === c && sql[i + 1] === c) {
          i += 2;
        } else if (sql[i] === c) {
          i += 1;
          break;
        } else {
          i += 1;
        }
      }
      salida += " ";
    } else if (c === "$" && !esLetraDeIdentificador(sql[i - 1])) {
      const etiqueta = /^\$([A-Za-z_\u0080-￿][\w\u0080-￿]*)?\$/.exec(sql.slice(i));
      if (etiqueta === null) {
        salida += c;
        i += 1;
      } else {
        const fin = sql.indexOf(etiqueta[0], i + etiqueta[0].length);
        i = fin === -1 ? sql.length : fin + etiqueta[0].length;
        salida += " ";
      }
    } else {
      salida += c;
      i += 1;
    }
  }
  return salida;
}

const CONTROL_DE_TRANSACCION =
  /^(BEGIN|COMMIT|ROLLBACK|ABORT|END|START\s+TRANSACTION)\b(?!\s*(?:WORK|TRANSACTION)?\s*TO\b)/i;

/**
 * Primera sentencia de control de transacción que traiga el archivo, o `null`. Detección
 * conservadora por sentencia (no por línea): los cuerpos de funciones y bloques DO no se analizan
 * porque `soloEstructura` los descarta. Limitación: los cuerpos SQL-estándar `BEGIN ATOMIC ... END`
 * (PG14+) no se pueden separar por `;` con certeza, así que un archivo que los use no se analiza.
 */
function controlDeTransaccionPropio(sql: string): string | null {
  const estructura = soloEstructura(sql);
  if (/\bBEGIN\s+ATOMIC\b/i.test(estructura)) return null;
  for (const sentencia of estructura.split(";")) {
    const coincidencia = CONTROL_DE_TRANSACCION.exec(sentencia.trim());
    if (coincidencia !== null) return (coincidencia[1] as string).toUpperCase();
  }
  return null;
}

export async function aplicarMigraciones(
  urlDirecta: string,
  carpeta: string,
  opciones: OpcionesDeMigraciones = {},
): Promise<ResultadoDeMigraciones> {
  if (hostConPooler(urlDirecta)) {
    throw new ErrorDeMigracion(
      "la cadena de conexión de migraciones apunta al pooler: el bloqueo de sesión no protege " +
        "detrás de PgBouncer; usá la cadena directa",
    );
  }
  const esperaDeBloqueo = milisegundosValidos(
    opciones.esperaDeBloqueoEnMs ?? ESPERA_DE_BLOQUEO_POR_DEFECTO_EN_MS,
    "esperaDeBloqueoEnMs",
  );
  const duracionMaxima = milisegundosValidos(
    opciones.duracionMaximaEnMs ?? DURACION_MAXIMA_POR_DEFECTO_EN_MS,
    "duracionMaximaEnMs",
  );

  const archivos = (await readdir(carpeta))
    .filter((nombre) => PATRON_DE_ARCHIVO.test(nombre))
    .sort();
  const numeros = archivos.map((nombre) => nombre.slice(0, 4));
  if (new Set(numeros).size !== numeros.length) {
    throw new ErrorDeMigracion("hay dos migraciones con el mismo número");
  }

  // Se lee y valida todo antes de tocar la base: una migración inválida no deja a medias a las demás.
  const contenidos = new Map<string, { sql: string; checksum: string }>();
  for (const nombre of archivos) {
    // CRLF → LF: el checksum no puede depender de cómo el sistema de archivos guardó el fin de línea.
    const sql = (await readFile(join(carpeta, nombre), "utf8")).replaceAll("\r\n", "\n");
    const control = controlDeTransaccionPropio(sql);
    if (control !== null) {
      throw new ErrorDeMigracion(
        `la migración ${nombre} trae su propio ${control}: el ejecutor ya la envuelve en una transacción`,
      );
    }
    contenidos.set(nombre, { sql, checksum: createHash("sha256").update(sql).digest("hex") });
  }

  const cliente = new pg.Client({ connectionString: urlDirecta });
  await cliente.connect();
  try {
    // El bloqueo de sesión se toma ANTES de fijar los tiempos máximos: esperar a que otro ejecutor
    // termine no es una falla (la duración de ese otro ya está acotada por su propio statement_timeout).
    await cliente.query("SELECT pg_advisory_lock($1)", [CLAVE_DE_BLOQUEO]);
    await cliente.query("SELECT set_config('lock_timeout', $1, false)", [`${esperaDeBloqueo}ms`]);
    await cliente.query("SELECT set_config('statement_timeout', $1, false)", [
      `${duracionMaxima}ms`,
    ]);
    await cliente.query(
      `CREATE TABLE IF NOT EXISTS migracion (
         nombre text PRIMARY KEY,
         checksum text NOT NULL,
         aplicada_en timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const registradas = await cliente.query<{ nombre: string; checksum: string }>(
      "SELECT nombre, checksum FROM migracion",
    );
    const checksums = new Map(registradas.rows.map((r) => [r.nombre, r.checksum]));

    const faltantes = [...checksums.keys()].filter((nombre) => !contenidos.has(nombre)).sort();
    if (faltantes.length > 0) {
      throw new ErrorDeMigracion(
        `hay migraciones registradas cuyo archivo ya no existe: ${faltantes.join(", ")}`,
      );
    }

    const aplicadas: string[] = [];
    const yaAplicadas: string[] = [];
    for (const [nombre, { sql, checksum }] of contenidos) {
      const previo = checksums.get(nombre);
      if (previo !== undefined) {
        if (previo !== checksum) {
          throw new ErrorDeMigracion(`la migración ${nombre} ya se aplicó y fue editada`);
        }
        yaAplicadas.push(nombre);
        continue;
      }
      await cliente.query("BEGIN");
      try {
        await cliente.query(sql);
        await cliente.query("INSERT INTO migracion (nombre, checksum) VALUES ($1, $2)", [
          nombre,
          checksum,
        ]);
        await cliente.query("COMMIT");
      } catch (error) {
        await cliente.query("ROLLBACK");
        throw error;
      }
      aplicadas.push(nombre);
    }
    return { aplicadas, yaAplicadas };
  } finally {
    await cliente.end();
  }
}
