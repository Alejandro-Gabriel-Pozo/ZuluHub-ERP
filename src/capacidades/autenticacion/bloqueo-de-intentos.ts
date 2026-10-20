/**
 * El límite de intentos del código del segundo factor (h5-p8 §2.4; ASUMIDO): 5 fallidos de un mismo usuario en 10
 * minutos lo bloquean 15 minutos. Previene: adivinar el código de 6 cifras a pedidos, que es justo lo que haría
 * quien ya tiene la cuenta de Google. El límite de pedidos de la librería no alcanza (cuenta por IP y por ruta, y en
 * el ADR-013 el contador del plugin no cortó en 12 fallos). Función pura: recibe cuándo fallaron los intentos
 * anteriores y el reloj, y decide; guardarlos es del adaptador de datos.
 */

const MINUTO_EN_MS = 60_000;

export type PoliticaDeIntentos = Readonly<{
  /** Cuántos fallos dentro de la ventana bloquean. */
  maximo: number;
  /** Los `maximo` fallos tienen que caber en esta ventana (inclusive). */
  ventanaEnMs: number;
  /** Cuánto dura el bloqueo desde el último de esos fallos. */
  bloqueoEnMs: number;
}>;

export const POLITICA_DE_INTENTOS: PoliticaDeIntentos = Object.freeze({
  maximo: 5,
  ventanaEnMs: 10 * MINUTO_EN_MS,
  bloqueoEnMs: 15 * MINUTO_EN_MS,
});

export type DecisionDeBloqueo =
  Readonly<{ bloqueado: false }> | Readonly<{ bloqueado: true; hasta: Date }>;

const LIBRE: DecisionDeBloqueo = Object.freeze({ bloqueado: false });

function politicaValida({ maximo, ventanaEnMs, bloqueoEnMs }: PoliticaDeIntentos): boolean {
  return (
    Number.isInteger(maximo) &&
    maximo >= 1 &&
    Number.isFinite(ventanaEnMs) &&
    ventanaEnMs > 0 &&
    Number.isFinite(bloqueoEnMs) &&
    bloqueoEnMs > 0
  );
}

/**
 * Cuánto tiempo hace falta recordar un fallo: más viejo que esto ya no puede formar parte de un bloqueo que siga en
 * pie (la ventana en que se juntan los fallos más lo que dura el bloqueo). El adaptador borra lo anterior.
 */
export function retencionDeFallosEnMs(politica: PoliticaDeIntentos = POLITICA_DE_INTENTOS): number {
  return politica.ventanaEnMs + politica.bloqueoEnMs;
}

/**
 * ¿Está bloqueado el usuario a `ahora`, dados los instantes de sus fallos? Hay bloqueo cuando algún grupo de `maximo`
 * fallos consecutivos cabe en la ventana; dura `bloqueoEnMs` desde el último de ese grupo y, si hay varios grupos,
 * manda el que termina más tarde. Los pedidos rechazados durante el bloqueo NO se registran como fallos (no lo
 * prolongan): el bloqueo termina a la hora que se anunció. Un instante inválido cuenta como `ahora` (falla cerrado:
 * no se puede esconder un fallo con una fecha rota). Política incoherente o `ahora` inválido: `RangeError` (error de programación).
 */
export function decisionDeBloqueo(
  fallos: readonly Date[],
  ahora: Date,
  politica: PoliticaDeIntentos = POLITICA_DE_INTENTOS,
): DecisionDeBloqueo {
  if (!politicaValida(politica)) {
    throw new RangeError("política de intentos inválida: el máximo y los plazos son positivos");
  }
  if (Number.isNaN(ahora.getTime())) throw new RangeError("ahora debe ser una fecha válida");
  const instantes = fallos
    .map((f) => (Number.isNaN(f.getTime()) ? ahora.getTime() : f.getTime()))
    .sort((a, b) => a - b);
  let hasta = Number.NEGATIVE_INFINITY;
  // Cada fallo desde el `maximo`-ésimo cierra un grupo de `maximo` fallos seguidos: empieza `maximo - 1` lugares antes.
  instantes.slice(politica.maximo - 1).forEach((ultimo, i) => {
    const primero = instantes[i] as number;
    if (ultimo - primero <= politica.ventanaEnMs)
      hasta = Math.max(hasta, ultimo + politica.bloqueoEnMs);
  });
  return ahora.getTime() < hasta ? { bloqueado: true, hasta: new Date(hasta) } : LIBRE;
}
