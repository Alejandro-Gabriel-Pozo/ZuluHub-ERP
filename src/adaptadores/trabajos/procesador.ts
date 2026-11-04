import type {
  ColaDeTrabajos,
  ManejadorDeTrabajo,
  ResultadoDeManejador,
  TrabajoTomado,
} from "../../puertos/cola-de-trabajos";
import type { EmpresaId } from "../../primitivas/identificadores/marca";
import type { Transacciones } from "../../puertos/transacciones";
import { ok } from "../../primitivas/resultado/resultado";
import { textoDeErrorSeguro, textoDeExcepcionSegura } from "./error-seguro";
import { decidirReintento, politicaDeReintentos, type PoliticaDeReintentos } from "./reintentos";

/**
 * Procesador de la cola de trabajos (ADR-007). Mecanismo genérico: no conoce ningún rubro; cada tipo
 * de trabajo trae su manejador. Vive entre los adaptadores (ADR-001: "procesar es del adaptador") y
 * solo depende de puertos.
 *
 * Ciclo de un trabajo:
 *   1. Tomar: `UPDATE` condicionado en una transacción corta (ver `ColaDeTrabajos.tomar`). Cuenta un
 *      intento y fija el plazo (`tomado_hasta`). Quien pierde la carrera no ejecuta nada.
 *   2. Ejecutar el efecto de su tipo FUERA de toda transacción de la cola.
 *   3. Cerrar en otra transacción corta: `HECHO`; o `PENDIENTE` con espera creciente y tope; o
 *      `FALLIDO` si se agotaron los intentos o el error es definitivo. Un `FALLIDO` no se borra.
 *
 * Todas las transacciones de la cola usan el contexto `TRABAJOS` en `READ COMMITTED`: son un único
 * `UPDATE` condicionado, que la base resuelve de forma atómica sin conflictos de serialización.
 *
 * El reloj entra como dato (`ahora`); el plazo de toma se cuenta desde ese `ahora` (si una corrida
 * procesa muchos trabajos y tarda más que el plazo, otro procesador puede retomar los últimos: el
 * efecto es idempotente, solo se repite).
 */

/** Se informa algo que no pudo quedar registrado en la cola (por ejemplo, la base no respondió). */
export type ProblemaDelProcesador = Readonly<{
  /** `null`: no había un trabajo en juego (por ejemplo, falló la lectura de candidatos). */
  trabajoId: string | null;
  fase: "tomar" | "ejecutar" | "cerrar" | "despachar";
  /** Sin secretos (pasa por `textoDeErrorSeguro`). */
  mensaje: string;
}>;

export type TxDeCola = Readonly<{ cola: ColaDeTrabajos }>;

export type ConfiguracionDelProcesador = Readonly<{
  transacciones: Transacciones<TxDeCola>;
  /** Un manejador por tipo de trabajo. */
  manejadores: ReadonlyMap<string, ManejadorDeTrabajo>;
  politica?: Partial<PoliticaDeReintentos>;
  /** Para registrar lo que no se pudo guardar en la cola. Un aviso que falla no cambia nada. */
  alRegistrarProblema?: (problema: ProblemaDelProcesador) => void;
  /**
   * Cuánto como máximo espera `despacharAhora` antes de devolver el control (default 5 s). El trabajo
   * sigue por su cuenta; si el proceso se corta, el plazo de toma vence y el cron lo retoma.
   */
  topeDeEsperaDelDespachoEnMs?: number;
}>;

export type ResultadoDeProcesar =
  | "HECHO"
  | "REPROGRAMADO"
  | "FALLIDO"
  /** Otro procesador lo ganó, o todavía no le toca. */
  | "NO_TOMADO"
  /** Se ejecutó, pero otro lo había retomado (plazo vencido) y el cierre no se aplicó. */
  | "PERDIDO"
  /** No se pudo hablar con la cola; queda para el próximo intento del cron. */
  | "ERROR_INTERNO";

export type ResumenDeProcesamiento = Readonly<{
  candidatos: number;
  hechos: number;
  reprogramados: number;
  fallidos: number;
  noTomados: number;
  perdidos: number;
  errores: number;
}>;

/**
 * Cómo despachar de inmediato. Por defecto `despacharAhora` espera lo que dice `topeDeEsperaDelDespachoEnMs` y devuelve el
 * control (el trabajo sigue por su cuenta). Con `esperarHastaTerminar`, devuelve recién cuando terminó todo: es para quien
 * corre DESPUÉS de responder (`after()`), donde la plataforma puede congelar la función apenas ese trabajo termina y cortar
 * lo que quedó en vuelo (una llamada a ARCA de hasta 25 s). Lo acota entonces el plazo de la función (`maxDuration`) y los
 * tiempos propios de cada llamada, no este tope.
 */
export type OpcionesDeDespacho = Readonly<{ esperarHastaTerminar?: boolean }>;

export type ProcesadorDeTrabajos = Readonly<{
  /** Punto de entrada del cron: toma y ejecuta hasta `limite` trabajos disponibles. */
  procesarPendientes(opciones: { ahora: Date; limite: number }): Promise<ResumenDeProcesamiento>;
  /**
   * Intento inmediato después de confirmar la transacción que encoló los trabajos (por `id`).
   * Mejor esfuerzo: NUNCA lanza ni demora más que el tope; cualquier error queda en `ultimo_error` del
   * trabajo (que sigue `PENDIENTE` para el cron) o, si ni eso se pudo, en `alRegistrarProblema`.
   */
  despacharAhora(ids: readonly string[], ahora: Date, opciones?: OpcionesDeDespacho): Promise<void>;
  /**
   * Lo mismo, pero para quien encoló por CLAVE de idempotencia y no conoce el `id` (encolar no lo devuelve): busca los
   * trabajos de la empresa con esas claves y los despacha. Mejor esfuerzo, como `despacharAhora`: NUNCA lanza; si ni
   * siquiera pudo buscarlos, lo informa y el cron los levanta. Nunca mira trabajos de otra empresa.
   */
  despacharPorClaves(
    empresaId: EmpresaId,
    claves: readonly string[],
    ahora: Date,
    opciones?: OpcionesDeDespacho,
  ): Promise<void>;
  /** Toma y ejecuta un trabajo. No lanza. */
  procesarUno(id: string, ahora: Date): Promise<ResultadoDeProcesar>;
}>;

const TOPE_DEL_DESPACHO_POR_DEFECTO_EN_MS = 5_000;

class ErrorDeLaCola extends Error {
  constructor(detalle: string) {
    super(`la cola de trabajos falló: ${detalle}`);
    this.name = "ErrorDeLaCola";
  }
}

export function crearProcesadorDeTrabajos(
  configuracion: ConfiguracionDelProcesador,
): ProcesadorDeTrabajos {
  const { transacciones, manejadores } = configuracion;
  const politica = politicaDeReintentos(configuracion.politica);
  const topeDelDespacho =
    configuracion.topeDeEsperaDelDespachoEnMs ?? TOPE_DEL_DESPACHO_POR_DEFECTO_EN_MS;

  function informar(problema: ProblemaDelProcesador): void {
    try {
      configuracion.alRegistrarProblema?.(problema);
    } catch {
      // Un aviso que falla no puede tapar lo que se está informando.
    }
  }

  /** Una transacción corta de la cola. Los errores de la base se vuelven una excepción con nombre. */
  async function enLaCola<T>(ahora: Date, operar: (cola: ColaDeTrabajos) => Promise<T>) {
    const resultado = await transacciones.ejecutar(
      { contexto: { tipo: "TRABAJOS", ahora }, aislamiento: "read committed" },
      async ({ cola }) => ok(await operar(cola)),
    );
    if (!resultado.ok) {
      const error = resultado.error;
      throw new ErrorDeLaCola(
        error.tipo === "Inesperado" ? `${error.tipo} ${error.sqlstate ?? ""}`.trim() : error.tipo,
      );
    }
    return resultado.valor;
  }

  async function cerrar(
    trabajo: TrabajoTomado,
    ahora: Date,
    resultado: ResultadoDeManejador,
  ): Promise<ResultadoDeProcesar> {
    const { id, intentos } = trabajo;
    if (resultado.tipo === "HECHO") {
      const nota = resultado.nota === undefined ? null : textoDeErrorSeguro(resultado.nota);
      const cerrado = await enLaCola(ahora, (cola) => cola.marcarHecho(id, intentos, nota));
      return cerrado ? "HECHO" : "PERDIDO";
    }
    const error = textoDeErrorSeguro(resultado.error);
    const decision = resultado.definitivo
      ? ({ tipo: "FALLIDO" } as const)
      : decidirReintento(intentos, ahora, politica);
    if (decision.tipo === "FALLIDO") {
      const cerrado = await enLaCola(ahora, (cola) => cola.marcarFallido(id, intentos, error));
      return cerrado ? "FALLIDO" : "PERDIDO";
    }
    const cerrado = await enLaCola(ahora, (cola) =>
      cola.reprogramar(id, intentos, decision.proximoIntento, error),
    );
    return cerrado ? "REPROGRAMADO" : "PERDIDO";
  }

  async function ejecutarYCerrar(
    trabajo: TrabajoTomado,
    ahora: Date,
  ): Promise<ResultadoDeProcesar> {
    // Un trabajo cuyo proceso se cortó en cada intento llega acá con más intentos que el tope: no se
    // vuelve a ejecutar (podría ser lo que mata al proceso).
    if (trabajo.intentos > politica.maximoDeIntentos) {
      return cerrar(trabajo, ahora, {
        tipo: "ERROR",
        error: "se agotaron los intentos sin que ninguno llegara a cerrar el trabajo",
        definitivo: true,
      });
    }
    const manejador = manejadores.get(trabajo.tipo);
    let resultado: ResultadoDeManejador;
    if (manejador === undefined) {
      // Puede ser una versión vieja del código procesando un tipo nuevo: se reintenta, con tope.
      resultado = {
        tipo: "ERROR",
        error: `no hay manejador para el tipo '${trabajo.tipo}'`,
        definitivo: false,
      };
    } else {
      try {
        resultado = await manejador(trabajo, ahora);
      } catch (error) {
        resultado = { tipo: "ERROR", error: textoDeExcepcionSegura(error), definitivo: false };
      }
    }
    return cerrar(trabajo, ahora, resultado);
  }

  async function procesarUno(id: string, ahora: Date): Promise<ResultadoDeProcesar> {
    let trabajo: TrabajoTomado | null;
    try {
      const hasta = new Date(ahora.getTime() + politica.plazoDeTomaEnMs);
      trabajo = await enLaCola(ahora, (cola) => cola.tomar(id, ahora, hasta));
    } catch (error) {
      informar({ trabajoId: id, fase: "tomar", mensaje: textoDeExcepcionSegura(error) });
      return "ERROR_INTERNO";
    }
    if (trabajo === null) return "NO_TOMADO";
    try {
      return await ejecutarYCerrar(trabajo, ahora);
    } catch (error) {
      // No se pudo cerrar: queda `EN_CURSO` y, vencido el plazo, otro lo retoma.
      informar({ trabajoId: id, fase: "cerrar", mensaje: textoDeExcepcionSegura(error) });
      return "ERROR_INTERNO";
    }
  }

  async function despacharAhora(
    ids: readonly string[],
    ahora: Date,
    opciones: OpcionesDeDespacho = {},
  ): Promise<void> {
    if (ids.length === 0) return;
    const trabajo = (async () => {
      for (const id of ids) await procesarUno(id, ahora);
    })().catch((error: unknown) => {
      informar({ trabajoId: null, fase: "despachar", mensaje: textoDeExcepcionSegura(error) });
    });
    if (opciones.esperarHastaTerminar === true) {
      await trabajo;
      return;
    }
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const tope = new Promise<void>((resolver) => {
      temporizador = setTimeout(resolver, topeDelDespacho);
    });
    try {
      await Promise.race([trabajo, tope]);
    } finally {
      clearTimeout(temporizador);
    }
  }

  return {
    procesarUno,

    despacharAhora,

    async despacharPorClaves(empresaId, claves, ahora, opciones) {
      if (claves.length === 0) return;
      let ids: string[];
      try {
        ids = await enLaCola(ahora, (cola) => cola.idsPorClaves(empresaId, claves));
      } catch (error) {
        informar({ trabajoId: null, fase: "despachar", mensaje: textoDeExcepcionSegura(error) });
        return;
      }
      await despacharAhora(ids, ahora, opciones);
    },

    async procesarPendientes({ ahora, limite }) {
      if (!Number.isInteger(limite) || limite < 1) {
        throw new RangeError(`limite debe ser un entero mayor o igual a 1 (llegó ${limite})`);
      }
      const ids = await enLaCola(ahora, (cola) => cola.candidatos(ahora, limite));
      const cuenta: Record<ResultadoDeProcesar, number> = {
        HECHO: 0,
        REPROGRAMADO: 0,
        FALLIDO: 0,
        NO_TOMADO: 0,
        PERDIDO: 0,
        ERROR_INTERNO: 0,
      };
      for (const id of ids) cuenta[await procesarUno(id, ahora)] += 1;
      return {
        candidatos: ids.length,
        hechos: cuenta.HECHO,
        reprogramados: cuenta.REPROGRAMADO,
        fallidos: cuenta.FALLIDO,
        noTomados: cuenta.NO_TOMADO,
        perdidos: cuenta.PERDIDO,
        errores: cuenta.ERROR_INTERNO,
      };
    },
  };
}
