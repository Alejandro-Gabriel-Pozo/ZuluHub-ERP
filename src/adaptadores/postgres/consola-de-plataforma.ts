import pg from "pg";
import type { ClaveDeContexto } from "./contexto-firmado";
import { ErrorDeConfiguracion } from "./errores";
import { hostConPooler } from "./migraciones";
import type { ClienteDeBase } from "./login-temporal-de-plataforma";

/**
 * Lo que `cargar-entorno-consola.yml` hace en la BASE de `preview` para dejar andando la consola de plataforma: instalar su clave de
 * contexto en `contexto_clave` y darles login (clave al azar de esta corrida, vigencia de 90 días) a sus dos roles:
 * `pedernal_plataforma` (decisión del dueño 2026-11-19: login PERMANENTE solo en `preview`, reemplaza para este caso la del
 * 2026-11-05, que lo dejaba cerrado salvo 30 minutos) y `pedernal_autenticacion_plataforma` (0088). Usa la conexión DIRECTA del dueño
 * de la base (ningún rol limitado puede cambiar un rol ni escribir `contexto_clave`).
 *
 * Todo el cambio va en UNA transacción que queda ABIERTA mientras quien llama escribe en Vercel (`entreTanto`): si Vercel falla se
 * deshace todo (no queda una clave instalada ni un login nuevo que nadie conoce); si Vercel sale bien se confirma. La única falla que
 * deja la base y Vercel desparejos es que el `COMMIT` mismo falle después de que Vercel aceptó: la consola falla cerrado (la base no
 * reconoce lo que firma o rechaza la clave) y repetir el flujo con `rotar` lo corrige.
 *
 * Las claves de los roles viajan como parámetros del `format('%L')` de Postgres, nunca concatenadas, y ningún
 * mensaje de error las incluye. La clave de contexto se instala con la MISMA regla de `instalarClaveDeContexto` (idempotente con el
 * mismo secreto, falla con otro secreto para el mismo kid o si está revocada), repetida acá porque aquella abre su propia conexión y
 * esta tiene que ir dentro de la transacción única.
 */

export const ROL_DE_PLATAFORMA = "pedernal_plataforma";
export const ROL_DE_AUTENTICACION_DE_CONSOLA = "pedernal_autenticacion_plataforma";
/** Cuánto dura el login de los dos roles (`VALID UNTIL`); el workflow lo renueva sin cambiar la clave. Pasado ese plazo la consola falla cerrada. */
export const VIGENCIA_DEL_LOGIN_EN_DIAS = 90;
/** El primer kid de la consola: el 1 es el de la web y el 2 lo cargó el dueño a mano en Vercel y no quedó en la base (no se reutiliza). */
export const KID_MINIMO_DE_LA_CONSOLA = 3;

export type EstadoDeUnRol = Readonly<{ existe: boolean; puedeEntrar: boolean }>;
export type EstadoDeLaConsola = Readonly<{
  /** El kid más alto de `contexto_clave` (vigente o no), o `null` si no hay ninguna clave. */
  kidMaximo: number | null;
  roles: Readonly<Record<string, EstadoDeUnRol>>;
}>;

export type LoginNuevo = Readonly<{ rol: string; clave: string }>;
export type CambioDeLaConsola = Readonly<{
  /** La clave de contexto de la consola a instalar, o `null` si no se rota. */
  claveDeContexto: ClaveDeContexto | null;
  /** Roles a los que se les pone una clave nueva (con login y vigencia). */
  loginsNuevos: readonly LoginNuevo[];
  /** Roles que ya entran y solo se renueva la vigencia (misma clave). */
  renovar: readonly string[];
}>;

export type OpcionesDeConsola = Readonly<{
  crearCliente?: (cadena: string) => ClienteDeBase;
  /** Solo para las pruebas contra una base real: los roles son del servidor entero, así que prueban con roles propios. */
  rolesPermitidos?: readonly string[];
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

const ROLES_DE_LA_CONSOLA: readonly string[] = [ROL_DE_PLATAFORMA, ROL_DE_AUTENTICACION_DE_CONSOLA];

/** Lee (sin cambiar nada) el kid más alto instalado y si los dos roles existen y pueden entrar. */
export async function leerEstadoDeLaConsola(
  cadenaDelDueno: string,
  opciones: OpcionesDeConsola = {},
): Promise<EstadoDeLaConsola> {
  revisarCadena(cadenaDelDueno);
  const cliente = (opciones.crearCliente ?? clienteReal)(cadenaDelDueno);
  await cliente.connect();
  try {
    const { rows: claves } = await cliente.query(
      "SELECT max(kid)::int AS maximo FROM contexto_clave",
    );
    const maximo = claves[0]?.["maximo"];
    const { rows: roles } = await cliente.query(
      "SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = ANY($1::text[])",
      [[...ROLES_DE_LA_CONSOLA]],
    );
    const estado: Record<string, EstadoDeUnRol> = {};
    for (const rol of ROLES_DE_LA_CONSOLA) {
      const fila = roles.find((r) => r["rolname"] === rol);
      estado[rol] = { existe: fila !== undefined, puedeEntrar: fila?.["rolcanlogin"] === true };
    }
    return { kidMaximo: typeof maximo === "number" ? maximo : null, roles: estado };
  } finally {
    await cliente.end();
  }
}

/** El kid de la clave nueva de la consola: el siguiente al más alto instalado, nunca menor que `KID_MINIMO_DE_LA_CONSOLA`. */
export function kidDeLaClaveNueva(kidMaximo: number | null): number {
  return Math.max((kidMaximo ?? 0) + 1, KID_MINIMO_DE_LA_CONSOLA);
}

/**
 * Aplica el cambio en UNA transacción y la deja abierta mientras corre `entreTanto` (las escrituras en Vercel). Si `entreTanto`
 * devuelve `true`, confirma; si devuelve `false` o lanza, deshace. Devuelve si quedó confirmado.
 */
export async function aplicarCambioDeLaConsola(
  cadenaDelDueno: string,
  cambio: CambioDeLaConsola,
  entreTanto: () => Promise<boolean>,
  opciones: OpcionesDeConsola = {},
): Promise<boolean> {
  revisarCadena(cadenaDelDueno);
  for (const rol of [...cambio.loginsNuevos.map((l) => l.rol), ...cambio.renovar]) {
    if (!(opciones.rolesPermitidos ?? ROLES_DE_LA_CONSOLA).includes(rol)) {
      throw new ErrorDeConfiguracion(`el rol ${rol} no es uno de los de la consola: no se toca`);
    }
  }
  const cliente = (opciones.crearCliente ?? clienteReal)(cadenaDelDueno);
  await cliente.connect();
  try {
    await cliente.query("BEGIN");
    try {
      if (cambio.claveDeContexto !== null) {
        const { kid, secreto } = cambio.claveDeContexto;
        const hex = secreto.toString("hex");
        await cliente.query(
          "INSERT INTO contexto_clave (kid, secreto) VALUES ($1, decode($2, 'hex')) ON CONFLICT (kid) DO NOTHING",
          [kid, hex],
        );
        const { rows } = await cliente.query(
          "SELECT secreto = decode($2, 'hex') AS igual, vigente FROM contexto_clave WHERE kid = $1",
          [kid, hex],
        );
        if (rows[0]?.["igual"] !== true) {
          throw new ErrorDeConfiguracion(
            `ya existe la clave de contexto kid ${kid} con otro secreto: la rotación se hace con otro kid`,
          );
        }
        if (rows[0]?.["vigente"] !== true) {
          throw new ErrorDeConfiguracion(`la clave de contexto kid ${kid} está revocada`);
        }
      }
      for (const { rol, clave } of cambio.loginsNuevos) {
        const { rows } = await cliente.query(
          "SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L VALID UNTIL %L', $1::text, $2::text, (now() + make_interval(days => $3::int))::text) AS sentencia",
          [rol, clave, VIGENCIA_DEL_LOGIN_EN_DIAS],
        );
        await cliente.query(sentenciaDe(rows[0]?.["sentencia"]));
      }
      for (const rol of cambio.renovar) {
        const { rows } = await cliente.query(
          "SELECT format('ALTER ROLE %I VALID UNTIL %L', $1::text, (now() + make_interval(days => $2::int))::text) AS sentencia",
          [rol, VIGENCIA_DEL_LOGIN_EN_DIAS],
        );
        await cliente.query(sentenciaDe(rows[0]?.["sentencia"]));
      }
      if (!(await entreTanto())) {
        await cliente.query("ROLLBACK");
        return false;
      }
      await cliente.query("COMMIT");
      return true;
    } catch (falla) {
      await cliente.query("ROLLBACK").catch(() => undefined);
      throw falla;
    }
  } finally {
    await cliente.end();
  }
}

function sentenciaDe(valor: unknown): string {
  if (typeof valor !== "string") {
    throw new ErrorDeConfiguracion("no se pudo armar la sentencia que cambia el rol");
  }
  return valor;
}
