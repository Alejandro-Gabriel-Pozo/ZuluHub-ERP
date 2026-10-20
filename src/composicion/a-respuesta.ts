import { randomBytes } from "node:crypto";
import {
  clasificarError,
  detalleDeFalla,
  errorInesperado,
  errorPublicoDe,
  type ErrorPublico,
  type Respuesta,
} from "../capacidades/experiencia/respuesta";
import { referenciaDeError } from "../plataforma/dominio/referencia";
import type { Resultado } from "../primitivas/resultado/resultado";

/**
 * `aRespuesta`: el ÚNICO traductor de lo que devuelve el servidor a lo que ve la pantalla (ADR-016).
 * Toda acción del servidor, ruta o página que habla con un caso de uso o una consulta pasa su resultado
 * (o su excepción) por acá. Previene: que el mensaje crudo de Postgres (`Inesperado`), el nombre de una
 * restricción o un id interno lleguen al navegador, y que cada acción traduzca a su manera (y se olvide
 * de una). Chequeo: `a-respuesta.test.ts` (ningún camino expone detalle) y las pruebas de contrato de
 * `test/web/` y de `src/capacidades/experiencia/respuesta.test.ts`.
 *
 * La decisión es pura (`capacidades/experiencia/respuesta.ts`); acá solo se agregan los dos efectos: el azar
 * de la referencia `PD-…` y el registro del servidor, que entran como dato para poder probarlos.
 */

export type DependenciasDeRespuesta = Readonly<{
  /** Registro del servidor: recibe `PD-… <detalle>`. Nunca sale en una respuesta. */
  registrar: (detalle: string) => void;
  /** Solo para las pruebas: el azar de la referencia. */
  azar?: () => Uint8Array;
}>;

/**
 * Un fallo inesperado: la referencia y el detalle van al registro del servidor; hacia afuera sale el error
 * genérico con la referencia. `indisponible` lo marca como `NO_DISPONIBLE` (la base no responde, mantenimiento).
 * Si el propio registro falla, la respuesta sale igual.
 */
export function respuestaDeFalla(
  detalle: string,
  dependencias: DependenciasDeRespuesta,
  indisponible = false,
): ErrorPublico {
  const referencia = referenciaDeError((dependencias.azar ?? (() => randomBytes(4)))());
  try {
    dependencias.registrar(`${referencia} ${detalle}`);
  } catch {
    // Un registro que falla no puede tapar la respuesta.
  }
  return errorInesperado(referencia, indisponible);
}

/** El error público de lo que vino en el lado `err` de un resultado (o en cualquier valor de falla). */
export function errorAPublico(error: unknown, dependencias: DependenciasDeRespuesta): ErrorPublico {
  const clasificado = clasificarError(error);
  return clasificado.tipo === "PUBLICO"
    ? errorPublicoDe(clasificado)
    : respuestaDeFalla(clasificado.detalle, dependencias);
}

/**
 * El resultado de un caso de uso o una consulta, listo para la pantalla. `presentar` arma el dato que sale
 * (solo lo que la pantalla necesita, sin ids internos de más): no hay forma de devolver el valor tal cual.
 */
export function aRespuesta<T, E, D>(
  resultado: Resultado<T, E>,
  dependencias: DependenciasDeRespuesta,
  presentar: (valor: T) => D,
): Respuesta<D> {
  if (resultado.ok) return { ok: true, dato: presentar(resultado.valor) };
  return { ok: false, error: errorAPublico(resultado.error, dependencias) };
}

/** Una excepción (la base caída, un defecto): siempre sin detalle y con referencia. */
export function aRespuestaDeExcepcion(
  excepcion: unknown,
  dependencias: DependenciasDeRespuesta,
): Respuesta<never> {
  return { ok: false, error: respuestaDeFalla(detalleDeFalla(excepcion), dependencias) };
}
