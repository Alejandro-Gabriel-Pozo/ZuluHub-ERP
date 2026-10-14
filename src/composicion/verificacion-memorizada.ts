/**
 * Una verificación asíncrona (sí/no) con memoria, para lo que se pregunta en cada pedido pero no hace falta
 * volver a averiguar en cada uno (la migración que tiene la base, la salud de la base). Reglas:
 *
 *  - Un «sí» vale `vigenciaDelSiEnMs` (puede ser `Infinity`: lo que ya está bien no se pregunta más); un «no»
 *    vale `vigenciaDelNoEnMs`, que es la espera antes de volver a mirar. Así una base que se arregla se nota
 *    pronto, y una que está mal no se consulta en cada pedido (no se la martilla).
 *  - Falla cerrado: si `verificar` lanza, es un «no». Quien arma `verificar` registra el detalle.
 *  - Una sola consulta en vuelo: los pedidos que llegan mientras se averigua comparten esa respuesta.
 *  - El reloj entra como dato (`ahora`, en milisegundos).
 */
export type ConfiguracionDeVerificacion = Readonly<{
  verificar: () => Promise<boolean>;
  ahora: () => number;
  vigenciaDelSiEnMs: number;
  vigenciaDelNoEnMs: number;
}>;

export function verificacionMemorizada(
  configuracion: ConfiguracionDeVerificacion,
): () => Promise<boolean> {
  const { verificar, ahora, vigenciaDelSiEnMs, vigenciaDelNoEnMs } = configuracion;
  let memoria: Readonly<{ valor: boolean; hasta: number }> | null = null;
  let enCurso: Promise<boolean> | null = null;

  async function averiguar(): Promise<boolean> {
    let valor: boolean;
    try {
      valor = await verificar();
    } catch {
      valor = false;
    }
    // La vigencia se cuenta desde que terminó de averiguar, no desde que empezó.
    memoria = { valor, hasta: ahora() + (valor ? vigenciaDelSiEnMs : vigenciaDelNoEnMs) };
    return valor;
  }

  return () => {
    if (memoria !== null && ahora() < memoria.hasta) return Promise.resolve(memoria.valor);
    enCurso ??= averiguar().finally(() => {
      enCurso = null;
    });
    return enCurso;
  };
}
