import pg from "pg";
import {
  ErrorDeConexionDeBase,
  ErrorDeConfiguracion,
  causaDeConexion,
  esConexionCortada,
} from "./errores";

/**
 * UN pozo de conexiones por cadena de conexión (y por lo tanto por rol de base) en cada proceso. La cadena trae el rol
 * (`pedernal_app`, `pedernal_autenticacion`, ...): dos usos de la misma cadena son el mismo rol y comparten pozo; dos roles
 * distintos nunca (otra cadena, otro pozo). Antes cada puerta (operativa, invitación, sesión) y cada pieza (lecturas del sistema)
 * armaba el suyo con la misma cadena y el mismo rol: con 40 pedidos a la vez una sola instancia llegó a 15 conexiones solo de la app.
 *
 * Lo que NO cambia ni se mezcla por compartir conexiones:
 *  - el contexto de cada transacción (`set_config('app.ctx', <token>, true)`) vale solo dentro de ella y se borra al confirmar o
 *    revertir: una conexión que vuelve al pozo no conserva la empresa de la anterior (lo prueba `test/integracion/pozo-por-rol.test.ts`);
 *  - el pozo es chico a propósito (`CONEXIONES_POR_POZO`): detrás del pooler de Neon (PgBouncer en modo transacción) la concurrencia
 *    útil por instancia es baja, y cuando se agota el pedido ESPERA su turno o, pasado `PLAZO_PARA_CONSEGUIR_CONEXION_EN_MS`, falla
 *    cerrado con un error; nunca abre una conexión de más.
 *
 * Cada usuario del pozo lo `suelta` al cerrarse; con el último, el pozo se cierra y sale del registro. Ese registro es de recursos
 * (conexiones), no de datos: no guarda nada de ninguna empresa ni de ningún pedido.
 */

/** Conexiones abiertas a la vez por pozo (informe de medición de rendimiento, §6 punto 2: «2 a 3»). */
export const CONEXIONES_POR_POZO = 3;

/**
 * Cuánto espera un pedido por una conexión libre cuando el pozo está agotado, antes de fallar con un error controlado. 5 s (decisión del
 * orquestador): el plan de Vercel Hobby corta la función a los 10 s, y esperar 10 s por una conexión se comería todo el pedido y dejaría una
 * pantalla rota en vez del error genérico. Única fuente: las demás esperas de la base (las lecturas del sistema) usan este mismo plazo.
 */
export const PLAZO_PARA_CONSEGUIR_CONEXION_EN_MS = 5_000;

export type OpcionesDePozo = Readonly<{
  /** La cadena de conexión del rol. El valor lo carga el dueño en el entorno; acá solo se usa (y de clave del registro). */
  url: string;
  maximoDeConexiones?: number;
  plazoParaConseguirConexionEnMs?: number;
  /** Se avisa cuando el servidor corta una conexión OCIOSA (el pozo la descarta y abre otra). */
  alCortarseUnaConexionOciosa?: (error: Error) => void;
}>;

/** La parte del pozo que usa Kysely: pedir una conexión y «cerrar». Cerrar es soltar lo propio, no cerrar el pozo de todos. */
export type PozoParaKysely = Readonly<{
  connect(): Promise<pg.PoolClient>;
  end(): Promise<void>;
  options: object;
}>;

export type PozoTomado = Readonly<{
  /** El pozo compartido, para consultas sueltas (`query`). No se cierra desde acá: se `suelta`. */
  pozo: pg.Pool;
  /** Lo que se le da a Kysely como pozo: su `end` suelta este uso. */
  paraKysely: PozoParaKysely;
  /** Deja de usar el pozo; con el último uso se cierra. Repetirlo no hace nada. */
  soltar(): Promise<void>;
}>;

/**
 * Presta una conexión del pozo a Kysely con dos protecciones que `pg-pool` NO da mientras la conexión está prestada:
 *
 *  1. Un oyente de 'error'. `pg-pool` saca el suyo al prestar la conexión; si el servidor la corta a mitad de una transacción
 *     (`pg_terminate_backend`, Neon reiniciando el cómputo, la red), `pg` emite 'error' sin oyente y Node tira abajo el proceso entero.
 *  2. La conexión rota se DESTRUYE y se libera en el acto (`release(error)`: el pozo la descarta y abre otra). Si no, dependería de
 *     que Kysely llame a `release`, y no lo hace cuando falla el `commit`/`rollback` de una transacción controlada (`startTransaction`):
 *     la conexión quedaba prestada para siempre y, con pozo de 1, todo pedido siguiente esperaba hasta fallar por pozo agotado.
 *     El `release` queda idempotente (`pg-pool` lanza si se libera dos veces) para que el de Kysely, que llega después, no haga nada.
 *
 * La transacción de una conexión cortada NO se confirma: el servidor la revierte al morir el backend, así que el trabajo queda
 * todo-o-nada. Si se cortó después de enviar el COMMIT y antes de la respuesta, el resultado es incierto: por eso toda escritura
 * lleva su clave de idempotencia y el reintento es seguro.
 */
async function prestar(pozo: pg.Pool): Promise<pg.PoolClient> {
  let cliente: pg.PoolClient;
  try {
    cliente = await pozo.connect();
  } catch (error) {
    // El mismo tipo y el mismo mensaje genérico para todo rol (también el de autenticación, que consume la librería de ingreso).
    const causa = causaDeConexion(error);
    throw causa === null ? error : new ErrorDeConexionDeBase(causa);
  }
  const liberarDelPozo = cliente.release.bind(cliente);
  let liberado = false;
  const liberar = (error?: Error | boolean): void => {
    if (liberado) return;
    liberado = true;
    cliente.removeListener("error", alRomperse);
    liberarDelPozo(error);
  };
  function alRomperse(error: Error): void {
    // `true` descarta la conexión en vez de devolverla al pozo (aunque `pg` ya la dio por no consultable).
    liberar(esConexionCortada(error) ? error : true);
  }
  cliente.on("error", alRomperse);
  cliente.release = liberar;
  return cliente;
}

type Entrada = {
  readonly pozo: pg.Pool;
  readonly avisos: Set<(error: Error) => void>;
  usos: number;
  cerrando: Promise<void> | null;
};

const pozos = new Map<string, Entrada>();

export function tomarPozo(opciones: OpcionesDePozo): PozoTomado {
  if (opciones.url === "") throw new ErrorDeConfiguracion("falta la cadena de conexión");
  const maximo = opciones.maximoDeConexiones ?? CONEXIONES_POR_POZO;
  if (!Number.isInteger(maximo) || maximo < 1) {
    throw new RangeError(
      `maximoDeConexiones debe ser un entero mayor o igual a 1 (llegó ${maximo})`,
    );
  }
  // El máximo también es parte de la clave: dos usos de la misma cadena con topes distintos (solo pasa en pruebas) no se pisan.
  const clave = `${maximo}|${opciones.url}`;
  let entrada = pozos.get(clave);
  if (entrada === undefined) {
    const avisos = new Set<(error: Error) => void>();
    const pozo = new pg.Pool({
      connectionString: opciones.url,
      max: maximo,
      connectionTimeoutMillis:
        opciones.plazoParaConseguirConexionEnMs ?? PLAZO_PARA_CONSEGUIR_CONEXION_EN_MS,
    });
    // Sin este oyente, el corte de una conexión ociosa tira abajo el proceso entero.
    pozo.on("error", (error) => {
      for (const avisar of avisos) avisar(error);
    });
    entrada = { pozo, avisos, usos: 0, cerrando: null };
    pozos.set(clave, entrada);
  }
  const propia = entrada;
  propia.usos += 1;
  const aviso = opciones.alCortarseUnaConexionOciosa;
  if (aviso !== undefined) propia.avisos.add(aviso);
  let soltado: Promise<void> | null = null;

  function soltar(): Promise<void> {
    soltado ??= (async () => {
      if (aviso !== undefined) propia.avisos.delete(aviso);
      propia.usos -= 1;
      if (propia.usos > 0) return;
      // El último en soltar cierra el pozo y lo saca del registro (uno nuevo, si hace falta, empieza de cero).
      if (pozos.get(clave) === propia) pozos.delete(clave);
      propia.cerrando ??= propia.pozo.end();
      await propia.cerrando;
    })();
    return soltado;
  }

  return {
    pozo: propia.pozo,
    paraKysely: {
      connect: () => prestar(propia.pozo),
      end: soltar,
      options: propia.pozo.options,
    },
    soltar,
  };
}

/** Cuántos pozos hay abiertos en este proceso (para las pruebas y para vigilar que no se multipliquen). */
export function cantidadDePozosAbiertos(): number {
  return pozos.size;
}
