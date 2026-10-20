import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { LIMITES_DEL_BARRIDO } from "../../capacidades/autenticacion/vigencia-de-sesion";
import type { BarridoDeAutenticacion } from "../../puertos/autenticacion";
import type { SegundoFactorDeAutenticacion } from "../../puertos/segundo-factor-de-autenticacion";
import { crearBarridoDeAutenticacion, type AutenticacionDb } from "./barrido-de-autenticacion";
import { ErrorDeConfiguracion } from "./errores";
import {
  crearSegundoFactorDePostgres,
  type SegundoFactorDb,
} from "./segundo-factor-de-autenticacion";
import type { SinTablas } from "./transacciones";

/**
 * La conexión del rol `zuluhub_autenticacion` (web-armazon §3.1, §4.1 y §4.2): el ÚNICO lugar donde se crea
 * el Kysely con el que la librería de ingreso lee y escribe su esquema. Así la regla de arquitectura
 * («la herramienta de datos solo en adaptadores/postgres») se respeta y el adaptador de autenticación no
 * importa `kysely` ni `pg`: recibe esto armado por la composición.
 *
 * Ese rol no ve ninguna tabla de negocio (42501) y no tiene permiso de crear nada: no hay DDL en
 * ejecución. Una sola conexión (un solo pool) para todas las instancias por host. Cadena de conexión con
 * pooler de Neon: la librería usa sentencias sin nombre y una transacción corta, sin `SET` ni
 * `LISTEN` (verificado contra PgBouncer en el spike; Neon real: no verificado).
 */
export type ConfiguracionDeConexionDeAutenticacion = Readonly<{
  /** Cadena de conexión del rol de autenticación. El valor lo carga el dueño en el entorno; acá solo se usa. */
  url: string;
  maximoDeConexiones?: number;
  /** Se avisa cuando el servidor corta una conexión OCIOSA (el pool la descarta y abre otra). */
  alCortarseUnaConexionOciosa?: (error: Error) => void;
}>;

export type ConexionDeAutenticacion = Readonly<{
  /** El Kysely para la librería de ingreso (`database.db`). Nadie más lo usa. */
  db: Kysely<SinTablas>;
  barrido: BarridoDeAutenticacion;
  /** Los intentos, los pasos de TOTP usados y la marca de segundo factor de la sesión (consola de plataforma). */
  segundoFactor: SegundoFactorDeAutenticacion;
  /** Cierra todas las conexiones abiertas. */
  cerrar(): Promise<void>;
}>;

export function crearConexionDeAutenticacion(
  configuracion: ConfiguracionDeConexionDeAutenticacion,
): ConexionDeAutenticacion {
  if (configuracion.url === "") {
    throw new ErrorDeConfiguracion("falta la cadena de conexión de la autenticación");
  }
  const pool = new pg.Pool({
    connectionString: configuracion.url,
    max: configuracion.maximoDeConexiones ?? 5,
  });
  // Sin este oyente, el corte de una conexión ociosa tira abajo el proceso entero.
  pool.on("error", (error) => configuracion.alCortarseUnaConexionOciosa?.(error));
  const db = new Kysely<SinTablas>({ dialect: new PostgresDialect({ pool }) });
  return {
    db,
    barrido: crearBarridoDeAutenticacion(db.withTables<AutenticacionDb>(), LIMITES_DEL_BARRIDO),
    segundoFactor: crearSegundoFactorDePostgres(db.withTables<SegundoFactorDb>()),
    cerrar: () => db.destroy(),
  };
}
