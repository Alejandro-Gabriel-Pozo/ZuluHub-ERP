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

/** Lista permitida: el texto canónico de cada entero del rango. Sin `Number` ni parseo (ADR-006): lo que no está en la tabla no entra. */
const CUOTAS_POR_TEXTO: ReadonlyMap<string, Cuotas> = new Map(
  Array.from({ length: MAXIMO_DE_CUOTAS - MINIMO_DE_CUOTAS + 1 }, (_, i) => {
    const valor = MINIMO_DE_CUOTAS + i;
    return [String(valor), valor as Cuotas] as const;
  }),
);

export function cuotasDesdeTexto(texto: string): Resultado<Cuotas, "CUOTAS_INVALIDAS"> {
  const valor = CUOTAS_POR_TEXTO.get(texto);
  return valor === undefined ? err("CUOTAS_INVALIDAS") : ok(valor);
}
