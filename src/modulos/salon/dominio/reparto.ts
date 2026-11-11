import { ErrorDeValor } from "../../../primitivas/cantidad/errores";
import { porcentajeDesdeTexto } from "../../../primitivas/cantidad/porcentaje";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * LA ÚNICA REGLA DE REPARTO DE LA CUENTA (E7 §3.9, PP-4 decidido; ADR-006): la usan la pantalla (para proponer los importes) y el servidor (para
 * validar), así ningún centavo lo decide cada uno por su lado. Todo en centavos enteros (`bigint`), jamás `number`; texto decimal en la frontera.
 * Determinista y exacto: la suma de las partes es SIEMPRE el total al centavo. Previene: el centavo de más o de menos entre lo que se cobra y lo que
 * suman las cuentas, y que dos pantallas repartan distinto el mismo total.
 *  · Ítem compartido (D117): `floor(centavos / k)` para cada una de las elegidas y TODO el resto a la de menor número («el centavo que sobra va a
 *    la Cuenta 1»).
 *  · Partes iguales: `floor(total / n)` y el resto de a un centavo desde la parte 1.
 *  · Por porcentaje: restos mayores por centavo sobre los porcentajes; el de la parte 1 es siempre el resto hasta 100 %; en un empate de restos,
 *    gana la parte de menor número.
 */
export type ParteRepartida = Readonly<{ parte: number; importe: string }>;

export type ErrorDeReparto = "PARTES_INVALIDAS" | "IMPORTE_INVALIDO" | "PORCENTAJE_INVALIDO";

export const MAXIMO_DE_PARTES_POR_PORCENTAJE = 6;
export const MAXIMO_DE_CUENTAS_POR_ITEMS = 4;

function centavosDe(texto: string): Resultado<bigint, "IMPORTE_INVALIDO"> {
  try {
    const importe = importeDesdeTexto(ARS, texto);
    return importe.unidades < 0n ? err("IMPORTE_INVALIDO") : ok(importe.unidades);
  } catch (error) {
    if (error instanceof ErrorDeValor) return err("IMPORTE_INVALIDO");
    throw error;
  }
}

/** Centavos no negativos a texto decimal con 2 decimales (`1234` → `"12.34"`). */
const aTexto = (centavos: bigint): string => {
  const digitos = centavos.toString().padStart(3, "0");
  return `${digitos.slice(0, -2)}.${digitos.slice(-2)}`;
};

const esParteValida = (n: number, maximo: number): boolean =>
  Number.isSafeInteger(n) && n >= 1 && n <= maximo;

/** Un ítem compartido entre las cuentas elegidas (números de cuenta, sin repetir, al menos dos). */
export function repartirItemCompartido(
  importe: string,
  cuentas: readonly number[],
): Resultado<readonly ParteRepartida[], ErrorDeReparto> {
  const ordenadas = [...new Set(cuentas)].sort((a, b) => a - b);
  if (
    ordenadas.length !== cuentas.length ||
    ordenadas.length < 2 ||
    !ordenadas.every((c) => esParteValida(c, MAXIMO_DE_CUENTAS_POR_ITEMS))
  ) {
    return err("PARTES_INVALIDAS");
  }
  const total = centavosDe(importe);
  if (!total.ok) return total;
  const k = BigInt(ordenadas.length);
  const base = total.valor / k;
  const resto = total.valor - base * k;
  return ok(
    ordenadas.map((parte, i) => ({ parte, importe: aTexto(i === 0 ? base + resto : base) })),
  );
}

/** Un total en `n` partes iguales (2 a 6): el resto de a un centavo desde la parte 1. */
export function repartirEnPartesIguales(
  total: string,
  n: number,
): Resultado<readonly ParteRepartida[], ErrorDeReparto> {
  if (!Number.isSafeInteger(n) || n < 2 || n > MAXIMO_DE_PARTES_POR_PORCENTAJE) {
    return err("PARTES_INVALIDAS");
  }
  const centavos = centavosDe(total);
  if (!centavos.ok) return centavos;
  const k = BigInt(n);
  const base = centavos.valor / k;
  const resto = Number(centavos.valor - base * k);
  return ok(
    Array.from({ length: n }, (_, i) => ({
      parte: i + 1,
      importe: aTexto(base + (i < resto ? 1n : 0n)),
    })),
  );
}

const CIEN_POR_CIENTO = 1_000_000n; // 100 % con 4 decimales (escala de `Porcentaje`)

/**
 * Un total por porcentaje. `porcentajes` son los de las partes 2 en adelante (texto, hasta 4 decimales, de 0 a 100); el de la parte 1 es lo que
 * falta hasta 100 % (cada porcentaje debe dejar al menos 0 para ella). Restos mayores por centavo: cada parte recibe el piso de su parte exacta y
 * los centavos que faltan van, de a uno, a los mayores restos (empate: la de menor número).
 */
export function repartirPorPorcentaje(
  total: string,
  porcentajes: readonly string[],
): Resultado<readonly ParteRepartida[], ErrorDeReparto> {
  if (porcentajes.length < 1 || porcentajes.length + 1 > MAXIMO_DE_PARTES_POR_PORCENTAJE) {
    return err("PARTES_INVALIDAS");
  }
  const centavos = centavosDe(total);
  if (!centavos.ok) return centavos;
  const puntos: bigint[] = [];
  for (const texto of porcentajes) {
    try {
      puntos.push(porcentajeDesdeTexto(texto).unidades);
    } catch (error) {
      if (error instanceof ErrorDeValor) return err("PORCENTAJE_INVALIDO");
      throw error;
    }
  }
  const primera = CIEN_POR_CIENTO - puntos.reduce((a, p) => a + p, 0n);
  if (primera < 0n) return err("PORCENTAJE_INVALIDO");
  const pesos = [primera, ...puntos];
  const exactos = pesos.map((p) => centavos.valor * p); // escala 10^6
  const pisos = exactos.map((e) => e / CIEN_POR_CIENTO);
  const faltan = Number(centavos.valor - pisos.reduce((a, p) => a + p, 0n));
  const restos = exactos.map((e) => e % CIEN_POR_CIENTO);
  // Los centavos que faltan, de a uno, a la parte de mayor resto que todavía no recibió; con restos iguales, la de menor número (`>` estricto).
  const extra = new Set<number>();
  for (let k = 0; k < faltan; k++) {
    let mejor = -1;
    for (const [i, resto] of restos.entries()) {
      if (!extra.has(i) && (mejor === -1 || resto > (restos[mejor] as bigint))) mejor = i;
    }
    extra.add(mejor);
  }
  return ok(
    pisos.map((piso, i) => ({ parte: i + 1, importe: aTexto(piso + (extra.has(i) ? 1n : 0n)) })),
  );
}
