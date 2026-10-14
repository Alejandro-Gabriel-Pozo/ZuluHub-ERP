import pg from "pg";

/**
 * Serializa «preparar los roles y cargar sus contraseñas en Vercel» entre dos corridas del comando.
 * El bloqueo propio de `prepararRoles` se suelta en cuanto los roles quedan listos, pero la contraseña
 * recién generada solo existe en la memoria de ESA corrida hasta que llega a Vercel: una segunda corrida
 * que entrara en ese hueco vería «el rol ya tiene LOGIN» y «la variable no está en Vercel» y pediría
 * `--rotar` en vano. Este bloqueo de sesión (distinto del de `prepararRoles` y del de las migraciones)
 * lo cubre de punta a punta: la segunda corrida espera a que la primera termine y entonces ve la
 * variable ya cargada. Si el proceso muere, Postgres suelta el bloqueo al cerrarse la conexión.
 */

const CLAVE_DE_BLOQUEO = 7_340_003;

export async function conBloqueoDeCarga<T>(
  urlDirecta: string,
  accion: () => Promise<T>,
): Promise<T> {
  const cliente = new pg.Client({ connectionString: urlDirecta, connectionTimeoutMillis: 30_000 });
  cliente.on("error", () => undefined);
  await cliente.connect();
  try {
    await cliente.query("SELECT pg_advisory_lock($1)", [CLAVE_DE_BLOQUEO]);
    return await accion();
  } finally {
    await cliente.end();
  }
}
