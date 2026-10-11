import type { EmpresaId } from "../primitivas/identificadores/marca";
import type { Dato } from "./sin-secretos";

/**
 * Puerto `trabajos` (ADR-007): los efectos externos (mails, por ejemplo) se piden encolando una
 * fila en la MISMA transacción del caso de uso. Nunca se envía nada desde adentro de la
 * transacción: el reintento serializable la repite entera.
 */
export type TrabajoNuevo = Readonly<{
  /** `null`: ámbito plataforma. */
  empresaId: EmpresaId | null;
  tipo: string;
  /** Sin secretos (ni tokens en claro ni credenciales): lo que haga falta se recalcula al ejecutar. */
  datos: Readonly<Record<string, Dato>>;
  /** Única por empresa: encolar dos veces lo mismo deja una sola fila. */
  claveDeIdempotencia: string;
}>;

export type ResultadoDeEncolar = "ENCOLADO" | "YA_ENCOLADO";

export interface Trabajos {
  encolar(trabajo: TrabajoNuevo): Promise<ResultadoDeEncolar>;
}
