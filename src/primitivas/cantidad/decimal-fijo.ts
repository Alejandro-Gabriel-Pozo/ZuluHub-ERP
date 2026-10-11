import { ErrorDeValor } from "./errores";

/**
 * Decimales de escala fija guardados como `bigint` en su unidad mínima. Es el único lugar que
 * convierte entre texto y unidades; ni `Number` ni `parseFloat` participan (ADR-006).
 */

/** Máximo en unidades mínimas de un `numeric(18, s)`: 18 dígitos en total, cualquiera sea la escala. */
export const MAXIMO_DE_UNIDADES = 10n ** 18n - 1n;

const LARGO_MAXIMO_DE_TEXTO = 40;

/** Forma canónica: sin signo `+`, sin ceros a la izquierda, sin notación científica, punto decimal. */
const PATRON = /^(?<signo>-?)(?<entera>0|[1-9][0-9]*)(?:\.(?<fraccion>[0-9]+))?$/;

export function parsearDecimalFijo(texto: string, escala: number, nombre: string): bigint {
  if (texto.length > LARGO_MAXIMO_DE_TEXTO) {
    throw new ErrorDeValor("FORMATO_INVALIDO", `${nombre}: texto demasiado largo`);
  }
  const grupos = PATRON.exec(texto)?.groups;
  const entera = grupos?.["entera"];
  if (grupos === undefined || entera === undefined) {
    throw new ErrorDeValor("FORMATO_INVALIDO", `${nombre}: no es un decimal en forma canónica`);
  }
  const fraccion = grupos["fraccion"] ?? "";
  if (fraccion.length > escala) {
    throw new ErrorDeValor("DECIMALES_DE_MAS", `${nombre}: admite hasta ${escala} decimales`);
  }
  const unidades = BigInt(entera + fraccion.padEnd(escala, "0"));
  if (grupos["signo"] === "-") {
    if (unidades === 0n) {
      throw new ErrorDeValor("FORMATO_INVALIDO", `${nombre}: el cero no lleva signo`);
    }
    return -unidades;
  }
  return unidades;
}

export function formatearDecimalFijo(unidades: bigint, escala: number): string {
  const signo = unidades < 0n ? "-" : "";
  const digitos = (unidades < 0n ? -unidades : unidades).toString().padStart(escala + 1, "0");
  if (escala === 0) return `${signo}${digitos}`;
  const corte = digitos.length - escala;
  return `${signo}${digitos.slice(0, corte)}.${digitos.slice(corte)}`;
}

export function validarRango(
  unidades: bigint,
  minimo: bigint,
  maximo: bigint,
  nombre: string,
): void {
  if (unidades < minimo || unidades > maximo) {
    throw new ErrorDeValor("FUERA_DE_RANGO", `${nombre}: fuera del rango admitido`);
  }
}
