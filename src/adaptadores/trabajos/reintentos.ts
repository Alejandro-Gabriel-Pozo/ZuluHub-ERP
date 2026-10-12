/**
 * Política de reintentos de la cola de trabajos (ADR-007): espera creciente con tope, sin
 * aleatoriedad. Funciones puras: el reloj (`ahora`) entra como dato, así cada decisión se repite
 * igual y se prueba sin simular el tiempo.
 */
export type PoliticaDeReintentos = Readonly<{
  /** Intentos totales (el primero incluido) antes de dejar el trabajo `FALLIDO`. */
  maximoDeIntentos: number;
  /** Espera tras el primer intento fallido; se duplica en cada uno siguiente. */
  esperaBaseEnMs: number;
  /** Tope de la espera. */
  esperaMaximaEnMs: number;
  /**
   * Cuánto vale la toma de un trabajo: pasado ese plazo otro procesador puede retomarlo. Tiene que
   * ser mayor que lo que tarda en ejecutarse un trabajo (si no, el efecto se repite; es idempotente,
   * pero se repite).
   */
  plazoDeTomaEnMs: number;
}>;

/** 5 intentos con esperas de 1, 2, 4 y 8 minutos (tope de 6 horas); toma por 5 minutos. */
export const POLITICA_POR_DEFECTO: PoliticaDeReintentos = {
  maximoDeIntentos: 5,
  esperaBaseEnMs: 60_000,
  esperaMaximaEnMs: 6 * 3_600_000,
  plazoDeTomaEnMs: 5 * 60_000,
};

const esEnteroPositivo = (n: number): boolean => Number.isSafeInteger(n) && n >= 1;

/** Completa con los valores por defecto y valida: `RangeError` si algo no tiene sentido. */
export function politicaDeReintentos(
  parcial: Partial<PoliticaDeReintentos> = {},
): PoliticaDeReintentos {
  const politica = { ...POLITICA_POR_DEFECTO, ...parcial };
  for (const campo of [
    "maximoDeIntentos",
    "esperaBaseEnMs",
    "esperaMaximaEnMs",
    "plazoDeTomaEnMs",
  ] as const) {
    if (!esEnteroPositivo(politica[campo])) {
      throw new RangeError(
        `${campo} debe ser un entero mayor o igual a 1 (llegó ${politica[campo]})`,
      );
    }
  }
  if (politica.esperaMaximaEnMs < politica.esperaBaseEnMs) {
    throw new RangeError("esperaMaximaEnMs no puede ser menor que esperaBaseEnMs");
  }
  return politica;
}

/**
 * Espera antes del próximo intento, dado cuántos intentos ya se hicieron (el primero vale 1):
 * `base`, `2·base`, `4·base`... sin pasar del tope.
 */
export function esperaDeReintentoEnMs(intentos: number, politica: PoliticaDeReintentos): number {
  if (!esEnteroPositivo(intentos)) {
    throw new RangeError(`intentos debe ser un entero mayor o igual a 1 (llegó ${intentos})`);
  }
  return Math.min(politica.esperaMaximaEnMs, politica.esperaBaseEnMs * 2 ** (intentos - 1));
}

export type DecisionDeReintento =
  Readonly<{ tipo: "REPROGRAMAR"; proximoIntento: Date }> | Readonly<{ tipo: "FALLIDO" }>;

/**
 * Qué hacer con un trabajo cuyo intento número `intentos` falló: reprogramarlo con espera creciente
 * o, si ya se gastaron los intentos, darlo por `FALLIDO`.
 */
export function decidirReintento(
  intentos: number,
  ahora: Date,
  politica: PoliticaDeReintentos,
): DecisionDeReintento {
  if (!esEnteroPositivo(intentos)) {
    throw new RangeError(`intentos debe ser un entero mayor o igual a 1 (llegó ${intentos})`);
  }
  if (intentos >= politica.maximoDeIntentos) return { tipo: "FALLIDO" };
  return {
    tipo: "REPROGRAMAR",
    proximoIntento: new Date(ahora.getTime() + esperaDeReintentoEnMs(intentos, politica)),
  };
}
