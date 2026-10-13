import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { err, ok } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import type { TransaccionesPublicas } from "../../puertos/transacciones-publicas";
import { ErrorDeConfiguracion, traducirErrorDeBase } from "./errores";
import type { SinTablas } from "./transacciones";

/**
 * `TransaccionesPublicas` sobre Postgres (marcas y planes, §B.2.5): la puerta pública, con su propio rol
 * de base (`zuluhub_publico`) y su propia cadena de conexión.
 *
 *  - SIN contexto firmado: no hay `set_config('app.ctx', ...)`. Es la única puerta así, y por eso no
 *    comparte código con `crearTransacciones` (que firma el contexto en cada transacción): el aislamiento
 *    de este rol lo dan sus `GRANT` por columna y sus políticas, no un contexto.
 *  - Solo lectura (`READ ONLY`): una escritura falla con `25006` aunque el rol tuviera permiso. Es una
 *    segunda barrera sobre la primera, que es que el rol no tiene ningún permiso de escritura.
 *  - `REPEATABLE READ`: todas las consultas de un trabajo ven la misma foto de la base.
 *  - Sin reintentos: una transacción de solo lectura con foto fija no conflictúa.
 *  - Si falta la cadena de conexión falla cerrado: nunca cae en la de otra puerta.
 */
export type ConfiguracionDeTransaccionesPublicas<Tx> = Readonly<{
  /** Cadena de conexión del rol público. El valor lo carga el dueño en el entorno; acá solo se usa. */
  url: string;
  /** Arma lo que recibe el trabajo a partir de la conexión de la transacción (solo para la persistencia). */
  armar: (db: Kysely<SinTablas>) => Tx;
  maximoDeConexiones?: number;
  /** Se avisa cuando el servidor corta una conexión OCIOSA (el pool la descarta y abre otra). */
  alCortarseUnaConexionOciosa?: (error: Error) => void;
  /** Se avisa cada vez que `leer` devuelve un error `Inesperado`. No cambia lo que se devuelve. */
  alRegistrarErrorInesperado?: (error: ErrorInesperado) => void;
}>;

type ErrorInesperado = Extract<ErrorDePersistencia, { tipo: "Inesperado" }>;

export type TransaccionesPublicasDePostgres<Tx> = TransaccionesPublicas<Tx> & {
  /** Cierra todas las conexiones abiertas. */
  cerrar(): Promise<void>;
};

export function crearTransaccionesPublicas<Tx>(
  configuracion: ConfiguracionDeTransaccionesPublicas<Tx>,
): TransaccionesPublicasDePostgres<Tx> {
  if (configuracion.url === "") {
    throw new ErrorDeConfiguracion("falta la cadena de conexión de la puerta pública");
  }
  let conexion: Kysely<SinTablas> | null = null;

  function db(): Kysely<SinTablas> {
    if (conexion !== null) return conexion;
    const pool = new pg.Pool({
      connectionString: configuracion.url,
      max: configuracion.maximoDeConexiones ?? 5,
    });
    // Sin este oyente, el corte de una conexión ociosa tira abajo el proceso entero.
    pool.on("error", (error) => configuracion.alCortarseUnaConexionOciosa?.(error));
    conexion = new Kysely<SinTablas>({ dialect: new PostgresDialect({ pool }) });
    return conexion;
  }

  function registrar(error: ErrorInesperado): void {
    try {
      configuracion.alRegistrarErrorInesperado?.(error);
    } catch {
      // Un registro que falla no puede tapar el resultado real de la operación.
    }
  }

  return {
    async leer(trabajo) {
      try {
        const valor = await db()
          .transaction()
          .setIsolationLevel("repeatable read")
          .setAccessMode("read only")
          .execute((trx) => trabajo(configuracion.armar(trx)));
        return ok(valor);
      } catch (error) {
        const traducido = traducirErrorDeBase(error);
        if (traducido === null) throw error;
        if (traducido.tipo === "Inesperado") registrar(traducido);
        return err(traducido);
      }
    },

    async cerrar() {
      const actual = conexion;
      conexion = null;
      if (actual !== null) await actual.destroy();
    },
  };
}
