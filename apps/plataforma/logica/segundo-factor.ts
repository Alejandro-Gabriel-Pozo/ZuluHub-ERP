/** Señal de que la persona canceló el pedido del segundo factor. */
export const CANCELADO = Symbol("cancelado");

const MAXIMO_POR_DEFECTO = 2;

/**
 * Corre `intento`; si la puerta pide un segundo factor reciente (`pideCodigo`), la pantalla pide y verifica el
 * código (`pedirCodigo`: true = verificado, false = canceló) y se repite el MISMO `intento`. La clave de
 * idempotencia la captura el closure de `intento`: acá no se genera. Después de `maximoDeCodigos` pedidos se
 * devuelve el último resultado en vez de insistir. Si `intento` lanza, la excepción se propaga (el resultado es
 * incierto y lo maneja quien llama).
 */
export async function conSegundoFactor<R>(opciones: {
  intento: () => Promise<R>;
  pideCodigo: (r: R) => boolean;
  pedirCodigo: () => Promise<boolean>;
  maximoDeCodigos?: number;
}): Promise<R | typeof CANCELADO> {
  const maximo = opciones.maximoDeCodigos ?? MAXIMO_POR_DEFECTO;
  let pedidos = 0;
  let resultado = await opciones.intento();
  while (opciones.pideCodigo(resultado) && pedidos < maximo) {
    pedidos += 1;
    if (!(await opciones.pedirCodigo())) return CANCELADO;
    resultado = await opciones.intento();
  }
  return resultado;
}
