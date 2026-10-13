import type { Marca } from "../identificadores/marca";
import { err, ok, type Resultado } from "../resultado/resultado";
import {
  formatearDecimalFijo,
  MAXIMO_DE_UNIDADES,
  parsearDecimalFijo,
  validarRango,
} from "./decimal-fijo";
import { ErrorDeValor } from "./errores";
import { crearCantidad, ESCALA_DE_CANTIDAD, type Cantidad } from "./interno";
import { dividirRedondeando, type PoliticaDeRedondeo } from "./redondeo-entero";

/**
 * Cantidad con signo (`numeric(18,4)`, de −(10¹⁸−1) a 10¹⁸−1 unidades mínimas): la existencia de
 * stock puede quedar negativa y los renglones del libro llevan signo. `Cantidad` sigue siendo no
 * negativa; esta es una primitiva aparte. Ni `Number` ni `parseFloat` participan (ADR-006).
 *
 * A diferencia de `Cantidad`, lo que puede fallar por un valor de entrada se devuelve como
 * `Resultado` con un `ErrorDeValor` (código tipado) como valor, no se lanza.
 */
export type CantidadConSigno = Marca<{ readonly unidades: bigint }, "CantidadConSigno">;

export type ErrorDeCantidadConSigno = ErrorDeValor;

function crearCantidadConSigno(unidades: bigint): CantidadConSigno {
  validarRango(unidades, -MAXIMO_DE_UNIDADES, MAXIMO_DE_UNIDADES, "cantidad con signo");
  return Object.freeze({ unidades }) as CantidadConSigno;
}

/**
 * Convierte el `ErrorDeValor` de una validación en el error del `Resultado`. Cualquier otra cosa
 * (un `TypeError` por un argumento que no es texto, por ejemplo) es un defecto: se lanza, no se
 * traga (ADR-004).
 */
function comoResultado<T>(accion: () => T): Resultado<T, ErrorDeValor> {
  try {
    return ok(accion());
  } catch (e) {
    if (e instanceof ErrorDeValor) return err(e);
    throw e;
  }
}

/** Texto canónico con hasta 4 decimales y signo `-` opcional: `-1.5`, `0.0001`. Sin `-0`. */
export function cantidadConSignoDesdeTexto(
  texto: string,
): Resultado<CantidadConSigno, ErrorDeCantidadConSigno> {
  return comoResultado(() =>
    crearCantidadConSigno(parsearDecimalFijo(texto, ESCALA_DE_CANTIDAD, "cantidad con signo")),
  );
}

export function cantidadConSignoATexto(cantidad: CantidadConSigno): string {
  return formatearDecimalFijo(cantidad.unidades, ESCALA_DE_CANTIDAD);
}

/** Una `Cantidad` (no negativa) vista con signo: siempre entra en el rango. */
export function cantidadConSignoDesdeCantidad(cantidad: Cantidad): CantidadConSigno {
  return crearCantidadConSigno(cantidad.unidades);
}

/** `FUERA_DE_RANGO` si la suma se pasa del rango: nunca se satura ni se da la vuelta. */
export function sumarConSigno(
  a: CantidadConSigno,
  b: CantidadConSigno,
): Resultado<CantidadConSigno, ErrorDeCantidadConSigno> {
  return comoResultado(() => crearCantidadConSigno(a.unidades + b.unidades));
}

/** `FUERA_DE_RANGO` si la resta se pasa del rango. */
export function restarConSigno(
  a: CantidadConSigno,
  b: CantidadConSigno,
): Resultado<CantidadConSigno, ErrorDeCantidadConSigno> {
  return comoResultado(() => crearCantidadConSigno(a.unidades - b.unidades));
}

/** −1 si `a < b`, 0 si son iguales, 1 si `a > b`. */
export function compararConSigno(a: CantidadConSigno, b: CantidadConSigno): -1 | 0 | 1 {
  if (a.unidades < b.unidades) return -1;
  return a.unidades > b.unidades ? 1 : 0;
}

/** El rango es simétrico: negar nunca se sale de él. */
export function negarConSigno(cantidad: CantidadConSigno): CantidadConSigno {
  return crearCantidadConSigno(-cantidad.unidades);
}

/** Módulo como `Cantidad` (no negativa): es el «positiva + sentido» que guardan los renglones. */
export function valorAbsolutoDe(cantidad: CantidadConSigno): Cantidad {
  // Stryker disable next-line EqualityOperator: con cero, `-0n` y `0n` son el mismo valor
  return crearCantidad(cantidad.unidades < 0n ? -cantidad.unidades : cantidad.unidades);
}

export type PoliticaDeCantidad = PoliticaDeRedondeo;

const UNIDADES_POR_ENTERO = 10n ** BigInt(ESCALA_DE_CANTIDAD);

/**
 * Producto de dos cantidades (vendido × cantidad por unidad de una receta), redondeado una sola vez
 * a 4 decimales: 0,5 × 0,0185 = 0,00925 → 0,0093. Es cantidad y no dinero: el redondeo del dinero
 * sigue siendo uno por comprobante. Un producto fuera de rango devuelve `FUERA_DE_RANGO`.
 */
export function multiplicarCantidades(
  a: Cantidad,
  b: Cantidad,
  politica: PoliticaDeCantidad,
): Resultado<Cantidad, ErrorDeCantidadConSigno> {
  return comoResultado(() =>
    crearCantidad(dividirRedondeando(a.unidades * b.unidades, UNIDADES_POR_ENTERO, politica)),
  );
}
