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

/** Un trabajo ya encolado, visto por quien encola: su clave y en qué estado está. */
export type TrabajoEncolado = Readonly<{
  claveDeIdempotencia: string;
  estado: "PENDIENTE" | "EN_CURSO" | "HECHO" | "FALLIDO";
}>;

export interface Trabajos {
  encolar(trabajo: TrabajoNuevo): Promise<ResultadoDeEncolar>;
}

/** Los trabajos de quien reencola el mismo efecto más de una vez: además de encolar, mira lo encolado. */
export interface TrabajosReencolables extends Trabajos {
  /**
   * Los trabajos de la empresa cuya clave de idempotencia empieza con `prefijo` (en cualquier orden).
   * Sirve a quien reencola el mismo efecto más de una vez (la validación de un comprobante): saber si
   * ya hay uno vivo y qué número de intento sigue. Previene: un reencolado que choque con la clave de
   * un trabajo `FALLIDO` (queda `YA_ENCOLADO` y nunca corre) o que duplique uno vivo.
   */
  conPrefijo(empresaId: EmpresaId, prefijo: string): Promise<readonly TrabajoEncolado[]>;
}
