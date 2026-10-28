import type { EmpresaId } from "../primitivas/identificadores/marca";
import type { Dato } from "./sin-secretos";

/**
 * Puerto de la cola de trabajos, lado del procesador (ADR-007). Encolar es otro puerto (`trabajos`);
 * este es el que usa quien TOMA y MARCA trabajos, siempre con el contexto `TRABAJOS` (rol de base
 * `pedernal_trabajos`, que ve y avanza la cola y nada más: ADR-011, A7).
 *
 * Todas las operaciones son un `UPDATE` condicionado (nada de `FOR UPDATE`): tomar un trabajo es
 * ganar una carrera en la base. Los `marcar*` están "cercados" por `intentos`: solo cierra el trabajo
 * quien lo tiene tomado en ese intento; si otro lo retomó (plazo vencido), el cierre no hace nada.
 */
export type EstadoDeTrabajo = "PENDIENTE" | "EN_CURSO" | "HECHO" | "FALLIDO";

/**
 * Transiciones permitidas del estado. La base impone la misma tabla con un disparador (0003); un test
 * exige que ambas permitan exactamente lo mismo. `FALLIDO → PENDIENTE` es el reencolado de plataforma;
 * `HECHO` es definitivo.
 */
export const TRANSICIONES_DE_TRABAJO: Readonly<
  Record<EstadoDeTrabajo, readonly EstadoDeTrabajo[]>
> = {
  PENDIENTE: ["EN_CURSO"],
  EN_CURSO: ["PENDIENTE", "HECHO", "FALLIDO"],
  HECHO: [],
  FALLIDO: ["PENDIENTE"],
};

export type TrabajoTomado = Readonly<{
  id: string;
  /** `null`: ámbito plataforma. */
  empresaId: EmpresaId | null;
  tipo: string;
  datos: Readonly<Record<string, Dato>>;
  /** Con el intento actual ya contado (el primero vale 1). */
  intentos: number;
}>;

export interface ColaDeTrabajos {
  /**
   * Los ids de los trabajos que ya se pueden tomar (pendientes vencidos o con plazo de toma vencido),
   * los más atrasados primero. Es una lectura: el que gana el trabajo es `tomar`.
   */
  candidatos(ahora: Date, limite: number): Promise<string[]>;
  /**
   * Toma el trabajo si sigue disponible: `PENDIENTE` y vencido, o `EN_CURSO` con el plazo vencido.
   * Lo deja `EN_CURSO` hasta `tomadoHasta` y cuenta un intento. `null`: no estaba disponible (lo
   * ganó otro o todavía no le toca).
   */
  tomar(id: string, ahora: Date, tomadoHasta: Date): Promise<TrabajoTomado | null>;
  /** `EN_CURSO` → `HECHO`. `nota`: por qué terminó sin hacer nada, si fue el caso. `false`: ya no era suyo. */
  marcarHecho(id: string, intentos: number, nota: string | null): Promise<boolean>;
  /** `EN_CURSO` → `PENDIENTE` para `proximoIntento`, guardando el error. `false`: ya no era suyo. */
  reprogramar(id: string, intentos: number, proximoIntento: Date, error: string): Promise<boolean>;
  /** `EN_CURSO` → `FALLIDO` (la fila no se borra). `false`: ya no era suyo. */
  marcarFallido(id: string, intentos: number, error: string): Promise<boolean>;
  /** Los ids de los trabajos de la empresa con esas claves de idempotencia. */
  idsPorClaves(empresaId: EmpresaId, claves: readonly string[]): Promise<string[]>;
  /**
   * Las empresas que encolaron algún trabajo de ese tipo desde `desde` (en cualquier estado), sin repetir, hasta
   * `limite`. Es lo único que el cron puede saber de las empresas sin romper el aislamiento: ver la cola de todas es lo
   * que hace este rol, y no lee ninguna otra tabla. Sirve para saber a qué empresas barrerles lo que quedó en vuelo
   * (`fiscal.reconciliar`). El orden es por id; si llega `postergadasEn` (otro tipo de trabajo), es primero las que hace
   * más que no encolan ese tipo (las que nunca, antes que todas) y por id entre iguales: con más empresas que `limite`,
   * las pasadas sucesivas las recorren a todas.
   */
  empresasConTrabajosDe(
    tipo: string,
    desde: Date,
    limite: number,
    postergadasEn?: string,
  ): Promise<EmpresaId[]>;
}

/** Cómo termina un intento de ejecutar el efecto de un trabajo. */
export type ResultadoDeManejador =
  | Readonly<{
      tipo: "HECHO";
      /** Si el trabajo terminó sin hacer el efecto (por ejemplo, invitación revocada): el motivo. */
      nota?: string;
    }>
  | Readonly<{
      tipo: "ERROR";
      /** Sin secretos: ni tokens, ni enlaces, ni claves. */
      error: string;
      /** `true`: reintentar no sirve; el trabajo queda `FALLIDO` de inmediato. */
      definitivo: boolean;
    }>;

/**
 * El efecto de un tipo de trabajo. Puede ejecutarse más de una vez (reintento, plazo vencido): tiene
 * que ser idempotente. `ahora` entra como dato. Una excepción cuenta como error no definitivo.
 */
export type ManejadorDeTrabajo = (
  trabajo: TrabajoTomado,
  ahora: Date,
) => Promise<ResultadoDeManejador>;
