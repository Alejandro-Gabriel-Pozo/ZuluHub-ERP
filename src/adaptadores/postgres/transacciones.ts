import { AsyncLocalStorage } from "node:async_hooks";
import { Kysely, PostgresDialect, sql, type ControlledTransaction } from "kysely";
import type { Contexto, TipoDeContexto } from "../../contexto/contexto";
import type {
  ErrorDePersistencia,
  OpcionesDeTransaccion,
  Transacciones,
} from "../../puertos/transacciones";
import { err, type Resultado } from "../../primitivas/resultado/resultado";
import type { LecturasCompartidas } from "../../puertos/transacciones";
import { firmarContexto, type ClaveDeContexto } from "./contexto-firmado";
import { ErrorDeConfiguracion, esReintentable, traducirErrorDeBase } from "./errores";
import { tomarPozo } from "./pozos";

export { ErrorDeConfiguracion };

/**
 * Implementación de `Transacciones` sobre Postgres (ADR-004, ADR-009, ADR-010).
 *
 * - Una cadena de conexión por puerta (aplicación, grupo, trabajos, plataforma): cada una entra
 *   con su propio rol de base. Si falta la de la puerta pedida, falla: nunca cae en otra (R10).
 * - La primera sentencia de cada transacción fija el contexto FIRMADO con un único
 *   `set_config('app.ctx', <token>, true)`, que vale solo dentro de la transacción y por eso funciona
 *   detrás del pooler de Neon (P1). El token se firma con la clave obligatoria `clave` y se vuelve a
 *   firmar en cada reintento (ver `contexto-firmado.ts`). Sin clave no se construye el adaptador.
 * - Ante 40001 o 40P01 repite el trabajo completo, con espera creciente y al azar.
 */

export type ConfiguracionDeTransacciones<Tx> = Readonly<{
  /**
   * Cadena de conexión por puerta. Los valores los carga el dueño en el entorno; acá solo se usan.
   * Las puertas `INVITACION` y `SESION` son opcionales: si falta, usan la de `OPERATIVO` (las tres entran con
   * el rol de base de la aplicación, `pedernal_app`; lo que las distingue es el contexto firmado).
   */
  urls: Readonly<Partial<Record<TipoDeContexto, string>>>;
  /**
   * Clave con la que se firma el contexto de cada transacción (de `leerClaveDeContexto`).
   * Obligatoria: sin ella el aislamiento entre empresas no tiene con qué verificarse.
   */
  clave: ClaveDeContexto;
  /**
   * Arma lo que recibe el trabajo a partir de la conexión de la transacción. El `Kysely` es de uso
   * interno de las carpetas de persistencia: nunca se pasa al dominio. Llega sin tablas conocidas:
   * cada módulo agrega las suyas con `db.withTables<TablasDelModulo>()`. Recibe también el contexto
   * de la transacción (el mismo que se firma): lo usan los adaptadores que escriben quién actuó
   * (auditoría e idempotencia de plataforma) para sacar el actor del contexto y no del llamador.
   */
  armar: (db: Kysely<SinTablas>, contexto: Contexto) => Tx;
  /**
   * Lo mismo para las transacciones de SOLO LECTURA y las unidades de lecturas compartidas, que pueden resolver una sola vez lo que se
   * repite (los permisos). Si falta, esas transacciones usan `armar`. Las que escriben usan SIEMPRE `armar`: no tienen cómo memorizar.
   */
  armarDeLectura?: (db: Kysely<SinTablas>, contexto: Contexto) => Tx;
  maximoDeConexiones?: number;
  /** Cuánto espera un pedido por una conexión libre (por omisión, `PLAZO_PARA_CONSEGUIR_CONEXION_EN_MS`). Lo fija el primero que arma el pozo. */
  plazoParaConseguirConexionEnMs?: number;
  /**
   * Se avisa cuando el servidor corta una conexión OCIOSA (por ejemplo, Neon al escalar a cero). No
   * afecta a ninguna operación: el pool descarta la conexión y abre otra. Sirve para registrarlo.
   */
  alCortarseUnaConexionOciosa?: (error: Error) => void;
  /**
   * Se avisa cada vez que `ejecutar` devuelve un error `Inesperado` (ADR-004: "se registra"). No
   * cambia lo que se devuelve: si el aviso mismo falla, el resultado sigue igual.
   */
  alRegistrarErrorInesperado?: (error: ErrorInesperado) => void;
}>;

type ErrorInesperado = Extract<ErrorDePersistencia, { tipo: "Inesperado" }>;

/** Base sin tablas tipadas: cada módulo declara las suyas (`withTables`). */
export type SinTablas = Record<never, never>;

export type TransaccionesDePostgres<Tx> = Transacciones<Tx> &
  LecturasCompartidas & {
    /** Cierra todas las conexiones abiertas. */
    cerrar(): Promise<void>;
  };

/**
 * Cuánto puede durar una unidad de lecturas compartidas y seguir sumando llamadas. El contexto firmado vale 5 minutos
 * (`VIGENCIA_DEL_CONTEXTO_EN_S`): pasado este tope, las llamadas siguientes abren su propia transacción (con su propio token) en vez de
 * arrastrar uno por vencer. Una pantalla tarda milisegundos; esto es un seguro, no un plazo de uso.
 */
export const VIDA_MAXIMA_DE_LA_UNIDAD_EN_MS = 60_000;

// SERIALIZABLE puede abortar transacciones sin conflicto real (falsos positivos del detector, más
// frecuentes con tablas chicas); por eso se reintenta con espera creciente y al azar (ADR-004).
const REINTENTOS_POR_DEFECTO = 6;
const ESPERA_BASE_EN_MS = 10;
const ESPERA_MAXIMA_EN_MS = 250;

const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

export function crearTransacciones<Tx>(
  configuracion: ConfiguracionDeTransacciones<Tx>,
): TransaccionesDePostgres<Tx> {
  // Falla cerrado: sin una clave utilizable no se construye el adaptador.
  const clave: ClaveDeContexto = configuracion.clave;
  if (
    !Buffer.isBuffer((clave as Partial<ClaveDeContexto> | undefined)?.secreto) ||
    clave.secreto.length < 32
  ) {
    throw new ErrorDeConfiguracion("falta la clave de contexto (de 32 bytes o más)");
  }
  // Una conexión por CADENA (es decir, por rol de base), no por puerta: las puertas que entran con el mismo rol comparten pozo.
  const conexiones = new Map<string, Kysely<SinTablas>>();

  function conexionPara(tipo: TipoDeContexto): Kysely<SinTablas> {
    // La invitación y la sesión comparten el rol de base de la aplicación: sin cadena propia, usan la operativa.
    const url =
      configuracion.urls[tipo] ??
      (tipo === "INVITACION" || tipo === "SESION" ? configuracion.urls.OPERATIVO : undefined);
    if (url === undefined || url === "") {
      throw new ErrorDeConfiguracion(`falta la cadena de conexión de la puerta ${tipo}`);
    }
    const existente = conexiones.get(url);
    if (existente !== undefined) return existente;
    const { paraKysely } = tomarPozo({
      url,
      ...(configuracion.maximoDeConexiones === undefined
        ? {}
        : { maximoDeConexiones: configuracion.maximoDeConexiones }),
      ...(configuracion.plazoParaConseguirConexionEnMs === undefined
        ? {}
        : { plazoParaConseguirConexionEnMs: configuracion.plazoParaConseguirConexionEnMs }),
      ...(configuracion.alCortarseUnaConexionOciosa === undefined
        ? {}
        : { alCortarseUnaConexionOciosa: configuracion.alCortarseUnaConexionOciosa }),
    });
    const db = new Kysely<SinTablas>({ dialect: new PostgresDialect({ pool: paraKysely }) });
    conexiones.set(url, db);
    return db;
  }

  async function unIntento<T, E>(
    opciones: OpcionesDeTransaccion,
    trabajo: (tx: Tx) => Promise<Resultado<T, E>>,
  ): Promise<Resultado<T, E>> {
    const db = conexionPara(opciones.contexto.tipo);

    let transaccion = db.transaction().setIsolationLevel(opciones.aislamiento ?? "serializable");
    if (opciones.soloLectura === true) transaccion = transaccion.setAccessMode("read only");

    // Un error de negocio revierte la transacción: se lanza adentro y se recupera afuera.
    class Abortar extends Error {
      constructor(readonly resultado: Resultado<T, E>) {
        super("transacción abortada por un error de negocio");
      }
    }
    try {
      return await transaccion.execute(async (trx) => {
        // Se firma en cada intento, con el reloj real del servidor (no `contexto.ahora`: ese es un
        // dato de negocio). El token fijado vale solo dentro de esta transacción.
        const token = firmarContexto(clave, opciones.contexto, Math.floor(Date.now() / 1000));
        await sql`select set_config('app.ctx', ${token}, true)`.execute(trx);
        const resultado = await trabajo(
          (opciones.soloLectura === true
            ? (configuracion.armarDeLectura ?? configuracion.armar)
            : configuracion.armar)(trx, opciones.contexto),
        );
        if (!resultado.ok) throw new Abortar(resultado);
        // Si el trabajo atrapó un error de la base y devolvió `ok`, la transacción quedó abortada y
        // Postgres respondería al COMMIT con un ROLLBACK SIN error: se informaría éxito sin haber
        // guardado nada. Una sentencia trivial lo delata (25P02) antes de confirmar.
        await sql`select 1`.execute(trx);
        return resultado;
      });
    } catch (error) {
      if (error instanceof Abortar) return error.resultado;
      throw error;
    }
  }

  function registrar(error: ErrorInesperado): void {
    try {
      configuracion.alRegistrarErrorInesperado?.(error);
    } catch {
      // Un registro que falla no puede tapar el resultado real de la operación.
    }
  }

  /**
   * Las lecturas compartidas de UN pedido (`conLecturasCompartidas`). La unidad vive lo que dura el `trabajo` que la abrió y se ve solo
   * desde ese trabajo (`AsyncLocalStorage`: cada pedido corre en su propia cadena asíncrona, así que un pedido concurrente no la
   * ve). La transacción se abre al unirse la primera lectura y se cierra al terminar el trabajo; nada de la unidad sobrevive al pedido.
   *
   * Previene (cada cosa tiene su prueba en `test/integracion/lecturas-compartidas.test.ts`): que dos pedidos compartan lo leído; que una
   * escritura o una lectura de otro contexto se cuele en la transacción de solo lectura; que una falla de la base deje a las lecturas
   * siguientes sobre una transacción abortada (la unidad se da por rota y cada una abre la suya); que un pedido sostenga una conexión del
   * pozo mientras pide otra (la unidad se cierra antes de abrir cualquier transacción que no pueda unir).
   */
  type Unidad = {
    readonly contexto: Contexto;
    readonly desde: number;
    /** `ABIERTA`: admite llamadas. `ROTA`: una llamada falló, no admite más y se revierte al cerrar. `CERRADA`: ya no admite. */
    estado: "ABIERTA" | "ROTA" | "CERRADA";
    abriendo: Promise<Readonly<{ trx: ControlledTransaction<SinTablas>; tx: Tx }>> | null;
    readonly enCurso: Set<Promise<unknown>>;
    /** Cuántas transacciones PROPIAS (que no pudieron unirse) corre este pedido ahora: mientras haya una, no se abre otra ni se une una lectura. */
    sueltasEnCurso: number;
    /** Las lecturas unidas corren de a una (una conexión no atiende dos consultas a la vez): cada una espera a la anterior. */
    cola: Promise<unknown>;
  };
  const almacen = new AsyncLocalStorage<Unidad>();
  /** Marca lo que corre DENTRO de una lectura unida: lo que ella misma pida no se une (se esperaría a sí misma). */
  const dentroDeUnaLectura = new AsyncLocalStorage<true>();
  /** Lo mismo para lo que corre DENTRO de una transacción propia del pedido (una escritura): lo que ella pida adentro es suyo. */
  const dentroDeUnaSuelta = new AsyncLocalStorage<true>();

  const admite = (unidad: Unidad, opciones: OpcionesDeTransaccion): boolean =>
    unidad.estado === "ABIERTA" &&
    opciones.contexto === unidad.contexto &&
    opciones.soloLectura === true &&
    opciones.aislamiento === "read committed" &&
    Date.now() - unidad.desde < VIDA_MAXIMA_DE_LA_UNIDAD_EN_MS;

  function abrir(unidad: Unidad) {
    unidad.abriendo ??= (async () => {
      const db = conexionPara(unidad.contexto.tipo);
      const trx = await db
        .startTransaction()
        .setIsolationLevel("read committed")
        .setAccessMode("read only")
        .execute();
      try {
        const token = firmarContexto(clave, unidad.contexto, Math.floor(Date.now() / 1000));
        await sql`select set_config('app.ctx', ${token}, true)`.execute(trx);
        return {
          trx,
          tx: (configuracion.armarDeLectura ?? configuracion.armar)(trx, unidad.contexto),
        };
      } catch (error) {
        await trx.rollback().execute();
        throw error;
      }
    })();
    return unidad.abriendo;
  }

  /** Termina la unidad: confirma (o revierte si se rompió) y suelta la conexión. Repetirla no hace nada. */
  async function cerrarUnidad(unidad: Unidad): Promise<void> {
    if (unidad.estado === "CERRADA") return;
    const rota = unidad.estado === "ROTA";
    unidad.estado = "CERRADA";
    await Promise.allSettled([...unidad.enCurso]);
    if (unidad.abriendo === null) return;
    let abierta: Awaited<NonNullable<Unidad["abriendo"]>>;
    try {
      abierta = await unidad.abriendo;
    } catch {
      return; // No llegó a abrirse: no hay nada que cerrar.
    }
    if (rota) await abierta.trx.rollback().execute();
    else await abierta.trx.commit().execute();
  }

  /** Una lectura que se une a la transacción de la unidad: sin `BEGIN`, sin contexto propio y sin `COMMIT`. */
  async function ejecutarUnida<T, E>(
    unidad: Unidad,
    opciones: OpcionesDeTransaccion,
    trabajo: (tx: Tx) => Promise<Resultado<T, E>>,
    solo: () => Promise<Resultado<T, E | ErrorDePersistencia>>,
  ): Promise<Resultado<T, E | ErrorDePersistencia>> {
    const curso = unidad.cola.then(async () => {
      // Si mientras esperaba su turno la unidad se rompió o se cerró, esta lectura abre la suya.
      if (unidad.estado !== "ABIERTA") return solo();
      const { tx } = await abrir(unidad);
      // Una lectura no escribe: si el trabajo devuelve un error de negocio no hay nada que revertir.
      return dentroDeUnaLectura.run(true, () => trabajo(tx));
    });
    unidad.cola = curso.then(
      () => undefined,
      () => undefined,
    );
    unidad.enCurso.add(curso);
    try {
      return await curso;
    } catch (error) {
      // La transacción compartida pudo quedar abortada: desde acá nadie más se une, y cada lectura abre la suya.
      unidad.estado = "ROTA";
      if (esReintentable(error)) return solo();
      const traducido = traducirErrorDeBase(error);
      if (traducido === null) throw error;
      if (traducido.tipo === "Inesperado") registrar(traducido);
      return err(traducido);
    } finally {
      unidad.enCurso.delete(curso);
    }
  }

  async function ejecutarSolo<T, E>(
    opciones: OpcionesDeTransaccion,
    trabajo: (tx: Tx) => Promise<Resultado<T, E>>,
  ): Promise<Resultado<T, E | ErrorDePersistencia>> {
    const reintentos = opciones.reintentos ?? REINTENTOS_POR_DEFECTO;
    // Un valor que no sea entero >= 0 (NaN, negativo, 1.5, Infinity) rompe el bucle de reintentos.
    if (!Number.isInteger(reintentos) || reintentos < 0) {
      throw new RangeError(`reintentos debe ser un entero mayor o igual a 0 (llegó ${reintentos})`);
    }
    for (let intento = 0; ; intento++) {
      try {
        return await unIntento(opciones, trabajo);
      } catch (error) {
        if (esReintentable(error)) {
          if (intento >= reintentos) return err({ tipo: "ConcurrenciaAgotada" });
          await esperar(
            Math.min(ESPERA_MAXIMA_EN_MS, ESPERA_BASE_EN_MS * 2 ** intento) * (0.5 + Math.random()),
          );
          continue;
        }
        const traducido = traducirErrorDeBase(error);
        if (traducido === null) throw error;
        if (traducido.tipo === "Inesperado") registrar(traducido);
        return err(traducido);
      }
    }
  }

  return {
    async ejecutar(opciones, trabajo) {
      const unidad = almacen.getStore();
      const anidada =
        dentroDeUnaLectura.getStore() !== undefined || dentroDeUnaSuelta.getStore() !== undefined;
      if (unidad === undefined || unidad.estado !== "ABIERTA" || anidada) {
        return ejecutarSolo(opciones, trabajo);
      }
      // Un pedido NUNCA sostiene dos conexiones del pozo a la vez desde ramas distintas: con el pozo chico, muchos pedidos así se esperarían
      // entre sí. Si ya hay una transacción propia del pedido en curso, o una lectura unida y esta no puede unirse, falla cerrado con un
      // error tipado en vez de abrir una segunda conexión. NO se debe abrir una escritura (ni otra transacción que no pueda unirse) en
      // paralelo con las lecturas de un `conLecturasCompartidas`, ni dos a la vez: esperá a que la anterior termine.
      const fallaCerrado = () => {
        const caso: ErrorInesperado = {
          tipo: "Inesperado",
          sqlstate: null,
          mensaje:
            "se pidió una transacción en paralelo con otra del mismo pedido: no se abre una segunda conexión",
        };
        registrar(caso);
        return err(caso);
      };
      if (unidad.sueltasEnCurso > 0) return fallaCerrado();
      if (admite(unidad, opciones)) {
        return ejecutarUnida(unidad, opciones, trabajo, () => ejecutarSolo(opciones, trabajo));
      }
      if (unidad.enCurso.size > 0) return fallaCerrado();
      // No puede unirse y no hay nada en curso: se suelta la conexión de la unidad ANTES de abrir otra.
      unidad.sueltasEnCurso += 1;
      try {
        if (unidad.abriendo !== null) await cerrarUnidad(unidad);
        return await dentroDeUnaSuelta.run(true, () => ejecutarSolo(opciones, trabajo));
      } finally {
        unidad.sueltasEnCurso -= 1;
      }
    },

    async conLecturasCompartidas(contexto, trabajo) {
      const actual = almacen.getStore();
      if (actual !== undefined && actual.estado === "ABIERTA") {
        // Ya se comparte para este mismo contexto: no se abre otra unidad. Con otro contexto, la de afuera se suelta primero.
        if (actual.contexto === contexto) return trabajo();
        if (actual.abriendo !== null && actual.enCurso.size === 0) await cerrarUnidad(actual);
      }
      const unidad: Unidad = {
        contexto,
        desde: Date.now(),
        estado: "ABIERTA",
        abriendo: null,
        enCurso: new Set(),
        sueltasEnCurso: 0,
        cola: Promise.resolve(),
      };
      let resultado: Awaited<ReturnType<typeof trabajo>>;
      try {
        resultado = await almacen.run(unidad, trabajo);
      } catch (error) {
        // Si el trabajo falló, la unidad se revierte y se suelta; el error del trabajo es el que sale.
        unidad.estado = unidad.estado === "CERRADA" ? "CERRADA" : "ROTA";
        await cerrarUnidad(unidad).catch(() => undefined);
        throw error;
      }
      await cerrarUnidad(unidad);
      return resultado;
    },

    async cerrar() {
      await Promise.all([...conexiones.values()].map((db) => db.destroy()));
      conexiones.clear();
    },
  };
}
