/**
 * FICHA DEL DATO: CUOTAS DE UN COBRO CON CRÉDITO (decisión 129).
 *
 * - Qué es: la cantidad de cuotas que se anota al cobrar con tarjeta de crédito. Solo se anota: no calcula intereses ni importes.
 * - Cómo se escribe: entero de `MINIMO_DE_CUOTAS` (1) a `MAXIMO_DE_CUOTAS` (36), en texto canónico (`1`, `12`; no `01`, `1.5`, `-1`).
 *   El tope de 36 es un SUPUESTO S-4 (del orquestador, aprobado con el prototipo, no una norma): cambiarlo es esta constante.
 * - No es un importe: es un conteo, por eso viaja como `number` entero.
 * - Código de error: `CUOTAS_INVALIDAS`.
 */
import type { Marca } from "../identificadores/marca";
import { err, ok, type Resultado } from "../resultado/resultado";

export type Cuotas = Marca<number, "Cuotas">;

export const MINIMO_DE_CUOTAS = 1;
export const MAXIMO_DE_CUOTAS = 36;

/** Entero sin ceros a la izquierda ni signo; el largo (2 dígitos) lo acota el rango que sigue. */
const ENTERO_CANONICO = /^[1-9][0-9]?$/;

export function cuotasDesdeTexto(texto: string): Resultado<Cuotas, "CUOTAS_INVALIDAS"> {
  if (!ENTERO_CANONICO.test(texto)) return err("CUOTAS_INVALIDAS");
  const valor = Number(texto);
  if (valor < MINIMO_DE_CUOTAS || valor > MAXIMO_DE_CUOTAS) return err("CUOTAS_INVALIDAS");
  return ok(valor as Cuotas);
}
