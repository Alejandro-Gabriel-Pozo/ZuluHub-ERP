import pg from "pg";
import { ErrorDeConfiguracion } from "./errores";

/**
 * Las dos preguntas que la web le hace a la base SIN contexto firmado y SIN tocar datos de nadie (web-armazon
 * §5.7 y §8.1 W6), con el rol limitado de la aplicación (`zuluhub_app`, `ZULUHUB_DB_APP`):
 *
 *  - `ping`: `SELECT 1`, la salud. No lee ninguna tabla.
 *  - `ultimaMigracion`: el nombre de la última fila de la tabla de control `migracion`, para la guarda
 *    `MIGRACION_REQUERIDA`. Necesita que `zuluhub_app` pueda leer esa tabla (`GRANT SELECT`); sin ese permiso
 *    la base responde `42501` y la guarda falla cerrado (la app queda «En mantenimiento»).
 *
 * Ni una escritura ni una transacción: consultas sueltas y de solo lectura. Tiempos acotados del lado del
 * cliente (conexión y consulta): una base que no contesta no cuelga el pedido. Cadena con pooler de Neon (sin
 * `SET` ni opciones de sesión, que el pooler en modo transacción no admite). El pool se abre con la primera
 * consulta, no al crearse.
 */
export type LecturasDeSistema = Readonly<{
  ping(): Promise<void>;
  /** El nombre de la última migración aplicada, o `null` si la tabla está vacía. */
  ultimaMigracion(): Promise<string | null>;
  /** Cierra todas las conexiones abiertas. */
  cerrar(): Promise<void>;
}>;

export type ConfiguracionDeLecturasDeSistema = Readonly<{
  /** Cadena de conexión del rol de la aplicación. El valor lo carga el dueño en el entorno; acá solo se usa. */
  url: string;
  /** Se avisa cuando el servidor corta una conexión OCIOSA (el pool la descarta y abre otra). */
  alCortarseUnaConexionOciosa?: (error: Error) => void;
  plazoEnMs?: number;
}>;

const PLAZO_POR_DEFECTO_EN_MS = 5_000;

export function crearLecturasDeSistema(
  configuracion: ConfiguracionDeLecturasDeSistema,
): LecturasDeSistema {
  if (configuracion.url === "") {
    throw new ErrorDeConfiguracion("falta la cadena de conexión de la aplicación");
  }
  const plazo = configuracion.plazoEnMs ?? PLAZO_POR_DEFECTO_EN_MS;
  let pool: pg.Pool | null = null;

  function conexion(): pg.Pool {
    if (pool !== null) return pool;
    const nuevo = new pg.Pool({
      connectionString: configuracion.url,
      max: 2,
      connectionTimeoutMillis: plazo,
      query_timeout: plazo,
    });
    // Sin este oyente, el corte de una conexión ociosa tira abajo el proceso entero.
    nuevo.on("error", (error) => configuracion.alCortarseUnaConexionOciosa?.(error));
    pool = nuevo;
    return nuevo;
  }

  return {
    async ping() {
      await conexion().query("SELECT 1");
    },

    async ultimaMigracion() {
      const { rows } = await conexion().query<{ nombre: string }>(
        "SELECT nombre FROM migracion ORDER BY nombre DESC LIMIT 1",
      );
      return rows[0]?.nombre ?? null;
    },

    async cerrar() {
      const actual = pool;
      pool = null;
      if (actual !== null) await actual.end();
    },
  };
}
