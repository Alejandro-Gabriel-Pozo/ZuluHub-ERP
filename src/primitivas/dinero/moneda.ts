import { ErrorDeValor } from "../cantidad/errores";

/** v1: solo pesos argentinos (ADR-006). Otra moneda se rechaza; agregar una es agregar una entrada. */
const DECIMALES = { ARS: 2 } as const;

export type Moneda = keyof typeof DECIMALES;

export const ARS: Moneda = "ARS";

export function moneda(codigo: string): Moneda {
  if (!Object.hasOwn(DECIMALES, codigo)) {
    throw new ErrorDeValor("MONEDA_NO_SOPORTADA", `moneda no soportada: ${codigo.slice(0, 8)}`);
  }
  return codigo as Moneda;
}

export function decimalesDe(m: Moneda): number {
  return DECIMALES[m];
}

export function exigirMismaMoneda(a: Moneda, b: Moneda): void {
  if (a !== b)
    throw new ErrorDeValor("MONEDA_DISTINTA", `no se puede combinar ${String(a)} con ${String(b)}`);
}
