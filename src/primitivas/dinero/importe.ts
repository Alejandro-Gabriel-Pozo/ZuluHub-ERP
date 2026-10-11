import { formatearDecimalFijo, parsearDecimalFijo } from "../cantidad/decimal-fijo";
import { ErrorDeValor } from "../cantidad/errores";
import { crearImporte, type Importe } from "./interno";
import { decimalesDe, exigirMismaMoneda, moneda, type Moneda } from "./moneda";

export type { Importe } from "./interno";

/** Forma de un importe en JSON y en la frontera: texto decimal, nunca `number` (ADR-006). */
export type ImporteJson = Readonly<{ moneda: string; monto: string }>;

export function importeCero(m: Moneda): Importe {
  return crearImporte(m, 0n);
}

/** Parser estricto: más decimales de los que admite la moneda se rechaza, no se redondea. */
export function importeDesdeTexto(m: Moneda, texto: string): Importe {
  return crearImporte(m, parsearDecimalFijo(texto, decimalesDe(m), "importe"));
}

export function importeATexto(importe: Importe): string {
  return formatearDecimalFijo(importe.unidades, decimalesDe(importe.moneda));
}

export function importeDesdeJson(json: ImporteJson): Importe {
  if (typeof json.moneda !== "string" || typeof json.monto !== "string") {
    throw new ErrorDeValor("FORMATO_INVALIDO", "importe: moneda y monto deben ser texto");
  }
  return importeDesdeTexto(moneda(json.moneda), json.monto);
}

export function importeAJson(importe: Importe): ImporteJson {
  return { moneda: importe.moneda, monto: importeATexto(importe) };
}

export function sumar(a: Importe, b: Importe): Importe {
  exigirMismaMoneda(a.moneda, b.moneda);
  return crearImporte(a.moneda, a.unidades + b.unidades);
}

export function restar(a: Importe, b: Importe): Importe {
  exigirMismaMoneda(a.moneda, b.moneda);
  return crearImporte(a.moneda, a.unidades - b.unidades);
}

export function importesIguales(a: Importe, b: Importe): boolean {
  return a.moneda === b.moneda && a.unidades === b.unidades;
}
