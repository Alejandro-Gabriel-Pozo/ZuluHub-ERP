import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
// Con extensión `.ts` a propósito: lo carga `scripts/migrar-base.ts` directamente con Node (que borra
// los tipos pero no resuelve imports sin extensión).
import { ErrorDeMigracion, PATRON_DE_ARCHIVO, hostConPooler } from "./migraciones.ts";

/**
 * Qué migraciones tiene la base y cuáles faltan, SIN escribir nada (es lo que corre el modo «ver» de
 * `scripts/migrar-base.ts`). Todo ocurre dentro de una transacción `READ ONLY` que termina en
 * `ROLLBACK`: ni siquiera crea la tabla de control `migracion` si no existe (en ese caso todas las
 * migraciones están pendientes). No toma el bloqueo de sesión, porque no escribe.
 *
 * Detecta lo mismo que haría fallar a `aplicarMigraciones` (una migración ya aplicada que se editó, una
 * registrada cuyo archivo ya no está, dos con el mismo número) para avisarlo ANTES de tocar la base.
 * El checksum se calcula igual que en el ejecutor (SHA-256 del contenido con fin de línea LF): si
 * cambia allá, la prueba «ver después de aplicar no ve nada editado» lo delata.
 */

export type EstadoDeMigraciones = Readonly<{
  /** Si la tabla de control existe. Si no, nada se aplicó nunca. */
  tablaDeControl: boolean;
  /** Registradas y con el archivo intacto, en orden. */
  aplicadas: string[];
  /** Con archivo y sin registro, en el orden en que se aplicarían. */
  pendientes: string[];
  /** Registradas pero el archivo cambió después: aplicar va a fallar. */
  editadas: string[];
  /** Registradas pero el archivo ya no está: aplicar va a fallar. */
  sinArchivo: string[];
}>;

const TOPE_DE_CONEXION_EN_MS = 30_000;
const TOPE_DE_CONSULTA = "30s";

export async function leerEstadoDeMigraciones(
  urlDirecta: string,
  carpeta: string,
): Promise<EstadoDeMigraciones> {
  if (hostConPooler(urlDirecta)) {
    throw new ErrorDeMigracion(
      "la cadena de conexión apunta al pooler (el host lleva «-pooler»): las migraciones usan la " +
        "cadena DIRECTA. En Neon: Connect, y apagar «Connection pooling» antes de copiarla",
    );
  }

  const archivos = (await readdir(carpeta))
    .filter((nombre) => PATRON_DE_ARCHIVO.test(nombre))
    .sort();
  const numeros = archivos.map((nombre) => nombre.slice(0, 4));
  if (new Set(numeros).size !== numeros.length) {
    throw new ErrorDeMigracion("hay dos migraciones con el mismo número");
  }
  const checksumsDeArchivos = new Map<string, string>();
  for (const nombre of archivos) {
    // CRLF → LF, igual que el ejecutor: un checkout en Windows no hace pasar por editada una migración.
    const sql = (await readFile(join(carpeta, nombre), "utf8")).replaceAll("\r\n", "\n");
    checksumsDeArchivos.set(nombre, createHash("sha256").update(sql).digest("hex"));
  }

  const cliente = new pg.Client({
    connectionString: urlDirecta,
    connectionTimeoutMillis: TOPE_DE_CONEXION_EN_MS,
  });
  // Un error del socket sin escucha tumba el proceso con el texto crudo; la consulta en curso ya lo recibe.
  cliente.on("error", () => undefined);
  await cliente.connect();
  let tablaDeControl: boolean;
  let registradas: Map<string, string>;
  try {
    await cliente.query("BEGIN READ ONLY");
    try {
      await cliente.query("SELECT set_config('statement_timeout', $1, true)", [TOPE_DE_CONSULTA]);
      const existe = await cliente.query<{ existe: boolean }>(
        "SELECT to_regclass('migracion') IS NOT NULL AS existe",
      );
      tablaDeControl = existe.rows[0]?.existe === true;
      const filas = tablaDeControl
        ? await cliente.query<{ nombre: string; checksum: string }>(
            "SELECT nombre, checksum FROM migracion ORDER BY nombre",
          )
        : { rows: [] };
      registradas = new Map(filas.rows.map((fila) => [fila.nombre, fila.checksum]));
    } finally {
      await cliente.query("ROLLBACK");
    }
  } finally {
    await cliente.end();
  }

  const aplicadas: string[] = [];
  const pendientes: string[] = [];
  const editadas: string[] = [];
  for (const [nombre, checksum] of checksumsDeArchivos) {
    const previo = registradas.get(nombre);
    if (previo === undefined) pendientes.push(nombre);
    else if (previo === checksum) aplicadas.push(nombre);
    else editadas.push(nombre);
  }
  const sinArchivo = [...registradas.keys()].filter((nombre) => !checksumsDeArchivos.has(nombre));
  return { tablaDeControl, aplicadas, pendientes, editadas, sinArchivo: sinArchivo.sort() };
}
