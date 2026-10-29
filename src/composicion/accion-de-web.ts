import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { Resultado } from "../primitivas/resultado/resultado";
import { aRespuestaDeExcepcion, errorAPublico, type DependenciasDeRespuesta } from "./a-respuesta";
import type { ErrorDeEntrada } from "./entradas-de-facturacion";
import { aRespuestaFiscal } from "./errores-fiscales";

/**
 * Lo que tienen en común las acciones de la web del facturador (emitir, configurar los datos fiscales, los puntos de venta...):
 * leer el pedido, correr el caso de uso o la consulta con el contexto del servidor y traducir el resultado por
 * `aRespuestaFiscal`. Una excepción (la base caída, un defecto) sale sin detalle y con referencia. Un solo lugar: que cada
 * pantalla no lo escriba a su manera.
 */

/** La entrada que no tiene la forma pedida, como error público (sin el valor recibido). */
export const entradaInvalida = (
  respuesta: DependenciasDeRespuesta,
  error: ErrorDeEntrada,
): Respuesta<never> => ({ ok: false, error: errorAPublico(error, respuesta) });

export async function accionDeWeb<E, S, D>(
  respuesta: DependenciasDeRespuesta,
  crudo: unknown,
  leer: (crudo: unknown) => Resultado<E, ErrorDeEntrada>,
  correr: (entrada: E) => Promise<Resultado<S, unknown>>,
  presentar: (salida: S) => D,
): Promise<Respuesta<D>> {
  const entrada = leer(crudo);
  if (!entrada.ok) return entradaInvalida(respuesta, entrada.error);
  try {
    return aRespuestaFiscal(await correr(entrada.valor), respuesta, presentar);
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, respuesta);
  }
}
