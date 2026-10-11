import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

/**
 * Aplica en orden los archivos `NNNN_nombre.sql` de la carpeta de migraciones, cada uno en su propia
 * transacción, y deja registro con el checksum. Una migración ya aplicada que se editó después
 * rompe con un error: el historial no se reescribe, se agrega una migración nueva.
 *
 * Usa la cadena DIRECTA de la base (no la del pooler): las migraciones toman un bloqueo de sesión.
 */

const PATRON_DE_ARCHIVO = /^(\d{4})_[a-z0-9_]+\.sql$/;
const CLAVE_DE_BLOQUEO = 7_340_001;

export class ErrorDeMigracion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeMigracion";
  }
}

export type ResultadoDeMigraciones = Readonly<{ aplicadas: string[]; yaAplicadas: string[] }>;

export async function aplicarMigraciones(
  urlDirecta: string,
  carpeta: string,
): Promise<ResultadoDeMigraciones> {
  const archivos = (await readdir(carpeta))
    .filter((nombre) => PATRON_DE_ARCHIVO.test(nombre))
    .sort();
  const numeros = archivos.map((nombre) => nombre.slice(0, 4));
  if (new Set(numeros).size !== numeros.length) {
    throw new ErrorDeMigracion("hay dos migraciones con el mismo número");
  }

  const cliente = new pg.Client({ connectionString: urlDirecta });
  await cliente.connect();
  try {
    await cliente.query("SELECT pg_advisory_lock($1)", [CLAVE_DE_BLOQUEO]);
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

    const aplicadas: string[] = [];
    const yaAplicadas: string[] = [];
    for (const nombre of archivos) {
      const sql = await readFile(join(carpeta, nombre), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
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
