import { cantidadDesdeTexto } from "../../../../../../src/primitivas/cantidad/cantidad";
import { ErrorDeValor } from "../../../../../../src/primitivas/cantidad/errores";
import {
  importeATexto,
  importeCero,
  sumar,
  type Importe,
} from "../../../../../../src/primitivas/dinero/importe";
import { ARS } from "../../../../../../src/primitivas/dinero/moneda";
import { multiplicarPrecioPorCantidad } from "../../../../../../src/primitivas/dinero/monto-exacto";
import { precioUnitarioDesdeTexto } from "../../../../../../src/primitivas/dinero/precio-unitario";
import { POLITICA_VIGENTE, redondear } from "../../../../../../src/primitivas/dinero/redondeo";
import { formatearImporte } from "../../../patrones/formato-fiscal";
import { loteCompleto, type ControlDeLote } from "../movimientos/modelo-de-formularios";

/**
 * El modelo de vista de la grilla de «Carga inicial» (STK-C, FP-STK-08): qué filas están completas, cuánto vale cada una, el resumen y qué errores marcar. Puro: sin React ni servidor. TODO es ayuda de la pantalla:
 * el servidor valida cada renglón dentro de su transacción y decide. La cantidad y el costo llegan como texto decimal canónico (`"12.5"`, lo que entrega `CampoNumero`) y NUNCA pasan por `Number` (ADR-006).
 *
 * El «Valor» de una fila es cantidad × costo con las primitivas del dinero del sistema (`multiplicarPrecioPorCantidad` y `redondear` con `POLITICA_VIGENTE`, la mitad se aleja del cero, a centavos) y el total es la
 * suma de los valores ya redondeados de las filas (lo que se verifica a mano, fila por fila). SOLO informativo: el servidor no recibe valores y fija el promedio con el costo por unidad. Una fila sin costo no
 * tiene valor y no entra al promedio. SUPUESTO (DEC-STK-003): el total suma filas redondeadas, no la suma exacta redondeada una vez.
 */

export type FilaDeCarga = Readonly<{
  /** Identifica la fila para React (no cambia al quitar otra). */
  clave: number;
  articuloId: string;
  /** Texto decimal canónico o vacío. */
  cantidad: string;
  /** Texto decimal canónico o vacío (vacío = sin costo). */
  costo: string;
  /** Solo de un artículo controlado por lote (STK-E2b, DEC-STK-007): el código del lote y su vencimiento (`AAAA-MM-DD`), o vacío. */
  lote: string;
  vence: string;
}>;

export const FILA_VACIA = (clave: number): FilaDeCarga => ({
  clave,
  articuloId: "",
  cantidad: "",
  costo: "",
  lote: "",
  vence: "",
});

/** Corre una cuenta de las primitivas: un valor que no entra en ellas (texto roto, fuera de rango) es `null`; un fallo que no es de valor no se esconde. */
function comoValor<T>(cuenta: () => T): T | null {
  try {
    return cuenta();
  } catch (error) {
    // Stryker disable next-line ConditionalExpression: las primitivas solo lanzan `ErrorDeValor`; la guarda existe para no tragar un fallo ajeno y ese camino no se puede provocar.
    if (error instanceof ErrorDeValor) return null;
    throw error;
  }
}

const cantidadValida = (texto: string): boolean =>
  comoValor(() => cantidadDesdeTexto(texto).unidades > 0n) === true;

/** Lo que vale la fila (cantidad × costo, redondeado a centavos), o `null` si falta la cantidad o el costo, o alguno no es válido. */
function importeDeLaFila(fila: FilaDeCarga): Importe | null {
  if (fila.costo === "" || !cantidadValida(fila.cantidad)) return null;
  return comoValor(() =>
    redondear(
      multiplicarPrecioPorCantidad(
        ARS,
        precioUnitarioDesdeTexto(fila.costo),
        cantidadDesdeTexto(fila.cantidad),
      ),
      POLITICA_VIGENTE,
    ),
  );
}

/** El valor de la fila ya con formato de pesos (`$ 1.250,00`), o `null` si no se puede calcular. */
export function valorDeLaFila(fila: FilaDeCarga): string | null {
  const importe = importeDeLaFila(fila);
  return importe === null ? null : formatearImporte(importeATexto(importe));
}

export type ErrorDeFila = "CANTIDAD" | "COSTO";

/** Qué marcar en la fila: una cantidad escrita que no sirve (cero o fuera de rango) o un costo escrito que no sirve. Lo que todavía no se escribió no es un error. */
export function errorDeLaFila(fila: FilaDeCarga): ErrorDeFila | null {
  if (fila.cantidad !== "" && !cantidadValida(fila.cantidad)) return "CANTIDAD";
  if (fila.costo !== "" && comoValor(() => precioUnitarioDesdeTexto(fila.costo)) === null) {
    return "COSTO";
  }
  if (fila.costo !== "" && cantidadValida(fila.cantidad) && importeDeLaFila(fila) === null) {
    return "COSTO";
  }
  return null;
}

/** Cómo se controla por lote el artículo de una fila (lo da el servidor): `null` si no se controla. */
export type ControlesPorArticulo = Readonly<Record<string, ControlDeLote>>;

/**
 * Una fila lista para mandar: artículo elegido, cantidad mayor que cero, si hay costo uno que sirva y, si el artículo se controla por lote, el lote (y su vencimiento si el control lo pide). Sin `controles`, ningún
 * artículo se controla por lote (nada se pide de más).
 */
export const filaCompleta = (fila: FilaDeCarga, controles: ControlesPorArticulo = {}): boolean =>
  fila.articuloId !== "" &&
  cantidadValida(fila.cantidad) &&
  errorDeLaFila(fila) === null &&
  loteCompleto(controles[fila.articuloId] ?? null, fila.lote, fila.vence);

/** «Registrar» se ofrece con depósito, al menos una fila y todas completas (una fila a medias frena la tanda: nada se manda). */
export const puedeRegistrar = (
  depositoId: string,
  filas: readonly FilaDeCarga[],
  controles: ControlesPorArticulo = {},
): boolean =>
  depositoId !== "" && filas.length > 0 && filas.every((f) => filaCompleta(f, controles));

export type ResumenDeCarga = Readonly<{
  /** Cuántos artículos tiene la tanda (las filas completas). */
  articulos: number;
  /** El valor total de las filas con costo, con formato de pesos; `null` si no hay ninguna o no se puede sumar. */
  total: string | null;
  /** Cuántas filas completas no traen costo (no entran al promedio). */
  sinCosto: number;
}>;

export function resumenDeLaCarga(
  filas: readonly FilaDeCarga[],
  controles: ControlesPorArticulo = {},
): ResumenDeCarga {
  const completas = filas.filter((f) => filaCompleta(f, controles));
  const importes = completas.map(importeDeLaFila).filter((i): i is Importe => i !== null);
  const total =
    importes.length === 0
      ? null
      : comoValor(() => importeATexto(importes.reduce(sumar, importeCero(ARS))));
  return {
    articulos: completas.length,
    total: total === null ? null : formatearImporte(total),
    sinCosto: completas.filter((f) => f.costo === "").length,
  };
}

/** Los artículos que se pueden elegir en una fila: todos menos los ya elegidos en las otras (el servidor rechaza un artículo repetido: acá ni se ofrece). */
export function opcionesParaLaFila<T extends Readonly<{ valor: string }>>(
  opciones: readonly T[],
  filas: readonly FilaDeCarga[],
  clave: number,
): readonly T[] {
  const tomados = new Set(filas.filter((f) => f.clave !== clave).map((f) => f.articuloId));
  return opciones.filter((o) => !tomados.has(o.valor));
}
