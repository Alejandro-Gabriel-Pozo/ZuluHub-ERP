import {
  diasHastaElVencimiento,
  esDisponible,
  type LoteParaDisponibilidad,
} from "./disponibilidad";

/**
 * Lo puro de los lotes que piden las consultas y la apertura del control (E6 §3.2 y §3.5, T7). Cantidades en unidades mínimas (10⁻⁴), fechas
 * civiles `AAAA-MM-DD` y la jornada (`fecha_de_negocio`) que decide quien llama. Previene que «disponible» se calcule dos veces con reglas
 * distintas (existencias, puerto de ventas y lista de lotes salen de acá) y que una apertura deje los lotes sin sumar el saldo.
 */

export type LoteConExistencia = LoteParaDisponibilidad & Readonly<{ existencia: bigint }>;

/**
 * Lo DISPONIBLE: la suma de la existencia de los lotes disponibles (`esDisponible`). El «sin asignar» no lleva calidad ni fecha, así que cuenta;
 * una existencia negativa no resta (es deuda con el libro, no mercadería). Un artículo sin lotes no tiene disponible desglosado: quien llama usa
 * su existencia total.
 */
export function disponibleDeLotes(
  lotes: readonly LoteConExistencia[],
  fechaDeNegocio: string,
): bigint {
  let total = 0n;
  for (const lote of lotes) {
    // Stryker disable next-line EqualityOperator: con existencia cero, sumar o no sumar da lo mismo
    if (lote.existencia > 0n && esDisponible(lote, fechaDeNegocio)) total += lote.existencia;
  }
  return total;
}

/**
 * Lo que la apertura de un control tiene que llevar al lote «sin asignar», por depósito: la existencia del libro menos lo que ya suman los lotes
 * (todo, al activar por primera vez; la deriva, al reactivar un control que estuvo congelado: DEC-0104). Solo los depósitos con diferencia, en
 * orden de depósito. Puede ser negativa (el depósito está en negativo).
 */
export function diferenciasDeApertura(
  existenciaDelLibro: ReadonlyMap<string, bigint>,
  sumaDeLotes: ReadonlyMap<string, bigint>,
): readonly Readonly<{ depositoId: string; unidades: bigint }>[] {
  const depositos = new Set([...existenciaDelLibro.keys(), ...sumaDeLotes.keys()]);
  return [...depositos]
    .sort()
    .map((depositoId) => ({
      depositoId,
      unidades: (existenciaDelLibro.get(depositoId) ?? 0n) - (sumaDeLotes.get(depositoId) ?? 0n),
    }))
    .filter((d) => d.unidades !== 0n);
}

export type SituacionDeVencimiento =
  | Readonly<{ tipo: "VENCIDO"; dias: number }>
  | Readonly<{ tipo: "VENCE_HOY" }>
  | Readonly<{ tipo: "POR_VENCER"; dias: number }>;

/**
 * Cómo está un lote respecto de su vencimiento dentro de `dias` jornadas (E6 §3.5): vencido (con cuántas jornadas de atraso), vence hoy o vence en
 * N jornadas. `null` si no vence o vence después del horizonte. Los textos «Por vencer», «Vence hoy», «Vence en N días» son de la pantalla.
 */
export function situacionDeVencimiento(
  vence: string | null,
  fechaDeNegocio: string,
  dias: number,
): SituacionDeVencimiento | null {
  if (vence === null) return null;
  const faltan = diasHastaElVencimiento(vence, fechaDeNegocio);
  if (faltan < 0) return { tipo: "VENCIDO", dias: -faltan };
  if (faltan === 0) return { tipo: "VENCE_HOY" };
  return faltan <= dias ? { tipo: "POR_VENCER", dias: faltan } : null;
}
