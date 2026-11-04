import {
  importeATexto,
  importeCero,
  importeDesdeTexto,
  sumar,
} from "../../../../../../src/primitivas/dinero/importe";
import { ARS } from "../../../../../../src/primitivas/dinero/moneda";

/**
 * El paginador de la hoja A4: reparte los renglones en hojas con los altos que MIDIÓ el navegador. Pieza pura, sin DOM ni React.
 *
 * Reglas (cada una previene un fallo concreto; la prueba que falla si se la quita es `test/web/impresion-paginador.test.ts`):
 * - Un renglón nunca se parte entre dos hojas. Previene: una descripción cortada a la mitad en el papel.
 * - El pie se reserva SIEMPRE, también en las hojas que no son la última (mide lo que el bloque final necesita y es igual en todas).
 *   Previene: un renglón que se dibuja encima del total, del CAE o del QR.
 * - Toda hoja salvo la primera abre con la fila «Transporte» (el parcial de la anterior), que ocupa lugar. Previene: contar mal el lugar
 *   y desbordar la hoja (RG 1415, Anexo IV, punto 6 b) 2).
 * - Los parciales se suman con la primitiva de dinero (centavos enteros, sin `number`). Previene: un centavo corrido en «A transportar»
 *   (ADR-006). La suma exige textos con los decimales de la moneda, como los trae el modelo de impresión.
 * - Cada hoja lleva al menos un renglón: uno más alto que el cupo va solo y se marca `excedeLaHoja` (no se corta ni se cuelga).
 */

/** Lo que sobra de una suma de alturas fraccionales: por debajo de esto, dos medidas son la misma. */
const TOLERANCIA_EN_PX = 0.01;

export type EntradaDelPaginador = Readonly<{
  /** El alto medido de cada renglón, en px, en el orden en que se imprimen. */
  altosDeLosRenglones: readonly number[];
  /** El importe de cada renglón (texto decimal con los decimales de la moneda), en el mismo orden. */
  importes: readonly string[];
  /** El alto de lo que cabe en una hoja entre el encabezado de la hoja y el borde de abajo, pie incluido. */
  altoUtilDeLaHoja: number;
  /** El alto del pie: el del bloque final, igual en todas las hojas. */
  altoDelPie: number;
  /** El alto del encabezado de la tabla (se repite en cada hoja). */
  altoDelEncabezadoDeLaTabla: number;
  /** El alto de la fila «Transporte» con que abre toda hoja menos la primera. */
  altoDeLaFilaDeTransporte: number;
}>;

type HojaPaginada = Readonly<{
  /** El primer renglón de la hoja (índice) y el siguiente al último: `[desde, hasta)`. */
  desde: number;
  hasta: number;
  /** El parcial con que abre («Transporte»); `null` en la primera. */
  transporte: string | null;
  /** El parcial con que cierra («A transportar»); `null` en la última. */
  aTransportar: string | null;
}>;

export type Paginacion = Readonly<{
  hojas: readonly HojaPaginada[];
  /** La suma exacta de los importes: la prueba la compara con el total que informó ARCA; la hoja muestra el del modelo, no esta. */
  sumaDeLosRenglones: string;
  /** Verdadero si algún renglón solo no entra en una hoja vacía: la hoja lo dibuja igual y se desborda. */
  excedeLaHoja: boolean;
}>;

export function paginar(entrada: EntradaDelPaginador): Paginacion {
  const cantidad = entrada.altosDeLosRenglones.length;
  if (entrada.importes.length !== cantidad) {
    throw new RangeError("paginar: tiene que haber un importe por cada alto de renglón");
  }
  const cupo = entrada.altoUtilDeLaHoja - entrada.altoDelPie - entrada.altoDelEncabezadoDeLaTabla;
  const hojas: { desde: number; hasta: number; transporte: string | null }[] = [];
  let acumulado = importeCero(ARS);
  let excedeLaHoja = false;
  let i = 0;
  do {
    const esPrimera = hojas.length === 0;
    const desde = i;
    const transporte = esPrimera ? null : importeATexto(acumulado);
    let libre = cupo - (esPrimera ? 0 : entrada.altoDeLaFilaDeTransporte);
    while (i < cantidad) {
      const alto = entrada.altosDeLosRenglones[i] ?? 0;
      const entra = alto <= libre + TOLERANCIA_EN_PX;
      if (!entra && i > desde) break;
      if (!entra) excedeLaHoja = true;
      libre -= alto;
      acumulado = sumar(acumulado, importeDesdeTexto(ARS, entrada.importes[i] ?? ""));
      i += 1;
    }
    hojas.push({ desde, hasta: i, transporte });
  } while (i < cantidad);
  return {
    hojas: hojas.map((hoja, k) => ({
      ...hoja,
      aTransportar: hojas[k + 1]?.transporte ?? null,
    })),
    sumaDeLosRenglones: importeATexto(acumulado),
    excedeLaHoja,
  };
}
