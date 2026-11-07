import type pg from "pg";
import { ErrorDeConfiguracion } from "./errores";
import { tomarPozo, type PozoTomado } from "./pozos";

/**
 * Las dos preguntas que la web le hace a la base SIN contexto firmado y SIN tocar datos de nadie (web-armazon
 * §5.7 y §8.1 W6), con el rol limitado de la aplicación (`pedernal_app`, `PEDERNAL_DB_APP`):
 *
 *  - `ping`: `SELECT 1`, la salud. No lee ninguna tabla.
 *  - `ultimaMigracion`: el nombre de la última fila de la tabla de control `migracion`, para la guarda
 *    `MIGRACION_REQUERIDA`. Necesita que `pedernal_app` pueda leer esa tabla (`GRANT SELECT`); sin ese permiso
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
  let tomado: PozoTomado | null = null;

  /** El pozo del rol de la aplicación: el MISMO que usan las transacciones (misma cadena, mismo rol). Se toma con la primera consulta. */
  function conexion(): pg.Pool {
    tomado ??= tomarPozo({
      url: configuracion.url,
      ...(configuracion.alCortarseUnaConexionOciosa === undefined
        ? {}
        : { alCortarseUnaConexionOciosa: configuracion.alCortarseUnaConexionOciosa }),
    });
    return tomado.pozo;
  }

  /**
   * Una consulta suelta con el plazo propio de esta pieza: la espera por una conexión y la consulta juntas no pasan de `plazo`
   * (una base que no contesta no cuelga el pedido). El plazo de la consulta viaja con ella; el pozo es compartido y no lo fija.
   */
  async function consultar<T extends pg.QueryResultRow>(texto: string): Promise<T[]> {
    let reloj: NodeJS.Timeout | undefined;
    const vencido = new Promise<never>((_, rechazar) => {
      reloj = setTimeout(() => rechazar(new Error("la base no contestó a tiempo")), plazo);
    });
    try {
      // `query_timeout` lo lee `pg` por consulta, aunque el tipo de la consulta no lo declare.
      const configuracionDeLaConsulta: pg.QueryConfig & { query_timeout: number } = {
        text: texto,
        query_timeout: plazo,
      };
      const consulta = conexion().query<T>(configuracionDeLaConsulta);
      // Si el plazo gana, la consulta que sigue corriendo no puede quedar sin manejar.
      consulta.catch(() => undefined);
      return (await Promise.race([consulta, vencido])).rows;
    } finally {
      clearTimeout(reloj);
    }
  }

  return {
    async ping() {
      await consultar("SELECT 1");
    },

    async ultimaMigracion() {
      const filas = await consultar<{ nombre: string }>(
        "SELECT nombre FROM migracion ORDER BY nombre DESC LIMIT 1",
      );
      return filas[0]?.nombre ?? null;
    },

    async cerrar() {
      const actual = tomado;
      tomado = null;
      if (actual !== null) await actual.soltar();
    },
  };
}
