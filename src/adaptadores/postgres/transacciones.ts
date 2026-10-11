import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { Contexto, TipoDeContexto } from "../../contexto/contexto";
import type {
  ErrorDePersistencia,
  OpcionesDeTransaccion,
  Transacciones,
} from "../../puertos/transacciones";
import { err, type Resultado } from "../../primitivas/resultado/resultado";
import { esReintentable, traducirErrorDeBase } from "./errores";

/**
 * Implementación de `Transacciones` sobre Postgres (ADR-004, ADR-009, ADR-010).
 *
 * - Una cadena de conexión por puerta (aplicación, grupo, trabajos, plataforma): cada una entra
 *   con su propio rol de base. Si falta la de la puerta pedida, falla: nunca cae en otra (R10).
 * - La primera sentencia de cada transacción fija el contexto con `set_config(..., true)`, que vale
 *   solo dentro de la transacción y por eso funciona detrás del pooler de Neon (P1).
 * - Ante 40001 o 40P01 repite el trabajo completo, con espera creciente y al azar.
 */

export type ConfiguracionDeTransacciones<Tx> = Readonly<{
  /** Cadena de conexión por puerta. Los valores los carga el dueño en el entorno; acá solo se usan. */
  urls: Readonly<Partial<Record<TipoDeContexto, string>>>;
  /**
   * Arma lo que recibe el trabajo a partir de la conexión de la transacción. El `Kysely` es de uso
   * interno de las carpetas de persistencia: nunca se pasa al dominio. Llega sin tablas conocidas:
   * cada módulo agrega las suyas con `db.withTables<TablasDelModulo>()`.
   */
  armar: (db: Kysely<SinTablas>) => Tx;
  maximoDeConexiones?: number;
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

export class ErrorDeConfiguracion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeConfiguracion";
  }
}

export type TransaccionesDePostgres<Tx> = Transacciones<Tx> & {
  /** Cierra todas las conexiones abiertas. */
  cerrar(): Promise<void>;
};

// SERIALIZABLE puede abortar transacciones sin conflicto real (falsos positivos del detector, más
// frecuentes con tablas chicas); por eso se reintenta con espera creciente y al azar (ADR-004).
const REINTENTOS_POR_DEFECTO = 6;
const ESPERA_BASE_EN_MS = 10;
const ESPERA_MAXIMA_EN_MS = 250;

function valoresDeContexto(contexto: Contexto): [empresa: string, tenant: string, persona: string] {
  switch (contexto.tipo) {
    case "OPERATIVO":
      return [contexto.empresaId, "", contexto.personaId ?? ""];
    case "GRUPO":
      return ["", contexto.tenantId, contexto.personaId];
    case "PLATAFORMA":
    case "TRABAJOS":
      return ["", "", ""];
  }
}

const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

export function crearTransacciones<Tx>(
  configuracion: ConfiguracionDeTransacciones<Tx>,
): TransaccionesDePostgres<Tx> {
  const conexiones = new Map<TipoDeContexto, Kysely<SinTablas>>();

  function conexionPara(tipo: TipoDeContexto): Kysely<SinTablas> {
    const existente = conexiones.get(tipo);
    if (existente !== undefined) return existente;
    const url = configuracion.urls[tipo];
    if (url === undefined || url === "") {
      throw new ErrorDeConfiguracion(`falta la cadena de conexión de la puerta ${tipo}`);
    }
    const pool = new pg.Pool({
      connectionString: url,
      max: configuracion.maximoDeConexiones ?? 5,
    });
    // Sin este oyente, el corte de una conexión ociosa tira abajo el proceso entero.
    pool.on("error", (error) => configuracion.alCortarseUnaConexionOciosa?.(error));
    const db = new Kysely<SinTablas>({ dialect: new PostgresDialect({ pool }) });
    conexiones.set(tipo, db);
    return db;
  }

  async function unIntento<T, E>(
    opciones: OpcionesDeTransaccion,
    trabajo: (tx: Tx) => Promise<Resultado<T, E>>,
  ): Promise<Resultado<T, E>> {
    const db = conexionPara(opciones.contexto.tipo);
    const [empresa, tenant, persona] = valoresDeContexto(opciones.contexto);

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
        await sql`select
          set_config('app.empresa_id', ${empresa}, true),
          set_config('app.tenant_id', ${tenant}, true),
          set_config('app.persona_id', ${persona}, true)`.execute(trx);
        const resultado = await trabajo(configuracion.armar(trx));
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

  return {
    async ejecutar(opciones, trabajo) {
      const reintentos = opciones.reintentos ?? REINTENTOS_POR_DEFECTO;
      // Un valor que no sea entero >= 0 (NaN, negativo, 1.5, Infinity) rompe el bucle de reintentos.
      if (!Number.isInteger(reintentos) || reintentos < 0) {
        throw new RangeError(
          `reintentos debe ser un entero mayor o igual a 0 (llegó ${reintentos})`,
        );
      }
      for (let intento = 0; ; intento++) {
        try {
          return await unIntento(opciones, trabajo);
        } catch (error) {
          if (esReintentable(error)) {
            if (intento >= reintentos) return err({ tipo: "ConcurrenciaAgotada" });
            await esperar(
              Math.min(ESPERA_MAXIMA_EN_MS, ESPERA_BASE_EN_MS * 2 ** intento) *
                (0.5 + Math.random()),
            );
            continue;
          }
          const traducido = traducirErrorDeBase(error);
          if (traducido === null) throw error;
          if (traducido.tipo === "Inesperado") registrar(traducido);
          return err(traducido);
        }
      }
    },

    async cerrar() {
      await Promise.all([...conexiones.values()].map((db) => db.destroy()));
      conexiones.clear();
    },
  };
}
