import pg from "pg";

/**
 * Cuántos dominios ACTIVOS terminan en un sufijo (por ejemplo `hotelesdelneuquen.com.ar`), con el rol de LECTURA PÚBLICA de la base compartida
 * (`pedernal_publico`: solo puede leer columnas públicas de `dominio`, entre ellas `host`). Lo usa `npm run humo` para comprobar que los hosts de un cliente
 * con base propia NO están en la base compartida (si estuvieran, el resolutor de la web compartida los serviría con la marca equivocada). Previene: ese cruce
 * pasa sin que nadie lo vea, porque los dominios son datos y no hay otra prueba automática. Chequeo: `test/integracion/contar-dominios-con-sufijo.test.ts`.
 *
 * LÍMITE (a propósito): `dominio` tiene RLS y la política pública (`dominio_publico_leer`) solo deja ver los dominios ACTIVOS, que son los únicos que la web sirve: los pendientes, verificados o retirados NO se
 * cuentan acá. El paso manual con el SQL del dueño (`SELECT count(*) FROM dominio WHERE host LIKE '%sufijo'`) los ve a todos.
 *
 * Solo lectura por construcción: abre `BEGIN READ ONLY`, hace UNA consulta con el sufijo como parámetro (nunca pegado al texto) y termina con `ROLLBACK`.
 * El sufijo se valida con una lista de permitidos (letras minúsculas, dígitos, guiones y puntos, con al menos un punto): lo que no cumple se rechaza sin tocar la base.
 * Una falla sale con su tipo y sin mensaje: el mensaje de `pg` puede traer pedazos de la cadena de conexión.
 */
export const FORMA_DE_SUFIJO_DE_HOST =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

const PLAZO_EN_MS = 8_000;

/** Lo mínimo del cliente de `pg` que se usa: así se prueba sin base y se comprueba que la transacción es de solo lectura. */
export type ClienteDeConteo = Readonly<{
  connect(): Promise<unknown>;
  query(texto: string, parametros?: readonly string[]): Promise<{ rows: readonly unknown[] }>;
  end(): Promise<unknown>;
}>;

export type CrearClienteDeConteo = (cadena: string) => ClienteDeConteo;

const clienteReal: CrearClienteDeConteo = (cadena) =>
  new pg.Client({
    connectionString: cadena,
    connectionTimeoutMillis: PLAZO_EN_MS,
    query_timeout: PLAZO_EN_MS,
  });

export async function contarDominiosConSufijo(
  cadena: string,
  sufijo: string,
  crearCliente: CrearClienteDeConteo = clienteReal,
): Promise<number> {
  if (cadena.trim() === "") throw new RangeError("falta la cadena de lectura");
  if (!FORMA_DE_SUFIJO_DE_HOST.test(sufijo)) throw new RangeError("el sufijo de host no es válido");
  const cliente = crearCliente(cadena);
  try {
    await cliente.connect();
    await cliente.query("BEGIN READ ONLY");
    try {
      const { rows } = await cliente.query(
        "SELECT count(*)::int AS cuenta FROM dominio WHERE right(lower(host), length($1)) = $1",
        [sufijo],
      );
      const fila = rows[0] as { cuenta?: unknown } | undefined;
      if (typeof fila?.cuenta !== "number" || !Number.isInteger(fila.cuenta) || fila.cuenta < 0) {
        throw new TypeError("la base devolvió algo que no es un conteo");
      }
      return fila.cuenta;
    } finally {
      await cliente.query("ROLLBACK").catch(() => undefined);
    }
  } catch (error) {
    // Sin el mensaje ni el error original: los de `pg` pueden traer la cadena de conexión.
    const tipo = error instanceof Error ? error.name : "falla que no es un Error";
    // eslint-disable-next-line preserve-caught-error -- a propósito: la causa original de `pg` puede traer la cadena de conexión
    throw new Error(`no se pudo contar los dominios (${tipo})`);
  } finally {
    await cliente.end().catch(() => undefined);
  }
}
