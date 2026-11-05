import pg from "pg";
import { ErrorDeConfiguracion } from "./errores";
import { hostConPooler } from "./migraciones";
import { cadenaDeRol, claveAlAzar } from "./roles-de-la-aplicacion";

/**
 * Login TEMPORAL del rol `pedernal_plataforma`, para el flujo manual «Preparar la empresa de pruebas». Ese rol nace
 * `NOLOGIN` y `--preparar-roles` no lo toca nunca (nadie debería tener una cadena permanente con la que firmar como
 * plataforma). El flujo lo abre con una clave al azar que vive SOLO en el runner, lo usa, y lo CIERRA siempre
 * (`cerrarLoginDePlataforma`, en un paso `if: always()`): `NOLOGIN` y sin clave. Falla que previene: que quede un rol de
 * plataforma con login y una clave de la que nadie lleva la cuenta. El cierre verifica el estado final y falla fuerte si no
 * quedó cerrado. Usa la conexión DIRECTA del dueño de la base (ningún rol limitado puede cambiar un rol).
 */

export const ROL_DE_PLATAFORMA = "pedernal_plataforma";

/**
 * El login vence solo a los 30 minutos (`VALID UNTIL`): si el runner muere antes del cierre, pasado ese plazo la clave deja de
 * servir aunque el rol siga marcado con login. El cierre lo limpia (`VALID UNTIL 'infinity'`, sin clave, `NOLOGIN`).
 */
export const VIGENCIA_DEL_LOGIN_EN_MINUTOS = 30;

/** Lo mínimo del cliente de `pg` que se usa: se inyecta en las pruebas. */
export type ClienteDeBase = Readonly<{
  connect: () => Promise<unknown>;
  query: (texto: string, valores?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<unknown>;
}>;

export type OpcionesDeLoginTemporal = Readonly<{
  /** Para las pruebas: el cliente de base. Por defecto, `pg.Client` con la cadena. */
  crearCliente?: (cadena: string) => ClienteDeBase;
  generarClave?: () => string;
  /** Para las pruebas contra una base real: un rol propio de la prueba (los roles son del servidor entero). */
  rol?: string;
}>;

function clienteReal(cadena: string): ClienteDeBase {
  const cliente = new pg.Client({ connectionString: cadena, connectionTimeoutMillis: 30_000 });
  cliente.on("error", () => undefined);
  return cliente;
}

function revisarCadena(cadena: string): void {
  if (hostConPooler(cadena)) {
    throw new ErrorDeConfiguracion("la cadena del dueño apunta al pooler: usá la cadena directa");
  }
}

async function estaAbierto(cliente: ClienteDeBase, rol: string): Promise<boolean> {
  const { rows } = await cliente.query(
    "SELECT rolcanlogin AS puede FROM pg_roles WHERE rolname = $1",
    [rol],
  );
  const fila = rows[0];
  if (fila === undefined) {
    throw new ErrorDeConfiguracion(
      `el rol ${rol} no existe: faltan aplicar las migraciones que lo crean`,
    );
  }
  return fila["puede"] === true;
}

/**
 * Abre el login con una clave nueva y devuelve la cadena del rol (host y base de la del dueño). Si el rol YA tiene login
 * no lo toca (podría ser de otra corrida o de una decisión del dueño) y falla: el paso de cierre lo deja cerrado y se
 * repite el flujo.
 */
export async function abrirLoginDePlataforma(
  cadenaDelDueno: string,
  opciones: OpcionesDeLoginTemporal = {},
): Promise<Readonly<{ cadena: string; clave: string }>> {
  revisarCadena(cadenaDelDueno);
  const rol = opciones.rol ?? ROL_DE_PLATAFORMA;
  const clave = (opciones.generarClave ?? (() => claveAlAzar()))();
  const cliente = (opciones.crearCliente ?? clienteReal)(cadenaDelDueno);
  await cliente.connect();
  try {
    if (await estaAbierto(cliente, rol)) {
      throw new ErrorDeConfiguracion(
        `el rol ${rol} ya tiene login (¿quedó de otra corrida?). No se toca; el cierre de este flujo lo deja cerrado: repetí el flujo`,
      );
    }
    const { rows } = await cliente.query(
      "SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L VALID UNTIL %L', $1::text, $2::text, (now() + make_interval(mins => $3::int))::text) AS sentencia",
      [rol, clave, VIGENCIA_DEL_LOGIN_EN_MINUTOS],
    );
    const sentencia = rows[0]?.["sentencia"];
    if (typeof sentencia !== "string") {
      throw new ErrorDeConfiguracion("no se pudo armar la sentencia que abre el login");
    }
    await cliente.query("BEGIN");
    try {
      await cliente.query(sentencia);
      await cliente.query("COMMIT");
    } catch (falla) {
      await cliente.query("ROLLBACK").catch(() => undefined);
      throw falla;
    }
  } finally {
    await cliente.end();
  }
  return { cadena: cadenaDeRol(cadenaDelDueno, rol, clave, false).cadena, clave };
}

export type EstadoDelCierre = Readonly<{
  /** `true`: se verificó que la clave es NULL; `false`: el rol de la conexión no puede mirarla (se verificó solo `NOLOGIN`). */
  claveVerificada: boolean;
}>;

/**
 * Deja el rol `NOLOGIN` y sin clave, y VERIFICA el estado final: si el rol sigue pudiendo entrar, o su clave no es NULL
 * cuando se la puede mirar, lanza. Es idempotente (cerrar lo cerrado no cambia nada).
 */
export async function cerrarLoginDePlataforma(
  cadenaDelDueno: string,
  opciones: OpcionesDeLoginTemporal = {},
): Promise<EstadoDelCierre> {
  revisarCadena(cadenaDelDueno);
  const rol = opciones.rol ?? ROL_DE_PLATAFORMA;
  const cliente = (opciones.crearCliente ?? clienteReal)(cadenaDelDueno);
  await cliente.connect();
  try {
    // El rol tiene que existir (si no, no hay nada que cerrar y algo anda mal).
    await estaAbierto(cliente, rol);
    const { rows } = await cliente.query(
      "SELECT format('ALTER ROLE %I WITH NOLOGIN PASSWORD NULL VALID UNTIL %L', $1::text, 'infinity') AS sentencia",
      [rol],
    );
    const sentencia = rows[0]?.["sentencia"];
    if (typeof sentencia !== "string") {
      throw new ErrorDeConfiguracion("no se pudo armar la sentencia que cierra el login");
    }
    await cliente.query(sentencia);
    if (await estaAbierto(cliente, rol)) {
      throw new ErrorDeConfiguracion(
        `el rol ${rol} sigue pudiendo entrar después de cerrarlo: avisá al dueño y cerralo a mano`,
      );
    }
    let claveVerificada = false;
    try {
      const { rows: claves } = await cliente.query(
        "SELECT rolpassword IS NULL AS sin_clave FROM pg_authid WHERE rolname = $1",
        [rol],
      );
      if (claves[0]?.["sin_clave"] !== true) {
        throw new ErrorDeConfiguracion(
          `el rol ${rol} conserva una clave después de cerrarlo: avisá al dueño y cerralo a mano`,
        );
      }
      claveVerificada = true;
    } catch (falla) {
      if (falla instanceof ErrorDeConfiguracion) throw falla;
      // `pg_authid` solo la lee un superusuario: con el dueño de Neon no se puede mirar. `NOLOGIN` ya se verificó.
    }
    return { claveVerificada };
  } finally {
    await cliente.end();
  }
}
