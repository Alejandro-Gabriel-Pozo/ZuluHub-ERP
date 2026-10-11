import type { Marca } from "../identificadores/marca";
import { MAXIMO_DE_UNIDADES, validarRango } from "./decimal-fijo";

/**
 * Constructores sin parser, solo para `primitivas/dinero` y `primitivas/cantidad`. Una regla de
 * arquitectura impide importarlos desde cualquier otro lugar: el resto del sistema crea valores
 * únicamente desde texto validado.
 */

/** Escala de `numeric(18,4)`. */
export const ESCALA_DE_CANTIDAD = 4;
/** Escala de `numeric(7,4)`: porcentajes en puntos (`21.0000`). */
export const ESCALA_DE_PORCENTAJE = 4;
/** Cien por ciento expresado en unidades de porcentaje. */
export const CIEN_POR_CIENTO = 100n * 10n ** BigInt(ESCALA_DE_PORCENTAJE);

export type Cantidad = Marca<{ readonly unidades: bigint }, "Cantidad">;
export type Porcentaje = Marca<{ readonly unidades: bigint }, "Porcentaje">;

export function crearCantidad(unidades: bigint): Cantidad {
  validarRango(unidades, 0n, MAXIMO_DE_UNIDADES, "cantidad");
  return Object.freeze({ unidades }) as Cantidad;
}

export function crearPorcentaje(unidades: bigint): Porcentaje {
  validarRango(unidades, 0n, CIEN_POR_CIENTO, "porcentaje");
  return Object.freeze({ unidades }) as Porcentaje;
}
