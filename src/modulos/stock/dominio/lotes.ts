import { compararTexto } from "./movimiento";
import { esDisponible, type LoteParaDisponibilidad } from "./disponibilidad";

/**
 * La elección de lotes de una salida (E6 §3.2): primero el que vence antes (FEFO), después el que entró antes, después el id (orden total y
 * repetible: el mismo saldo da siempre la misma elección, así un reintento de la transacción escribe lo mismo). Puro, sobre cantidades en
 * unidades mínimas. Dos modos: ENTREGA (venta, consumo: solo lotes disponibles; lo que falta va a «sin asignar», que puede quedar negativo
 * según el control de existencia negativa, D125) y DESCARTE (merma, rotura, baja por vencimiento: nunca se bloquea por calidad ni por
 * vencimiento, D27). Previene vender un lote rechazado o vencido y dejar un lote real bajo cero.
 */
export type LoteCandidato = LoteParaDisponibilidad &
  Readonly<{
    loteId: string;
    esSinAsignar: boolean;
    /** `AAAA-MM-DD` de su primer ingreso al libro. */
    primerIngreso: string;
    /** Existencia del lote en el depósito, en unidades mínimas (el lote «sin asignar» puede ser negativo). */
    existencia: bigint;
  }>;

export type AsignacionDeLote = Readonly<{ loteId: string; unidades: bigint }>;

export type ModoDeSalida = "ENTREGA" | "DESCARTE";

/** El orden FEFO: vencimiento (los que no vencen, al final), primer ingreso, id. El «sin asignar» siempre va último. */
export function ordenarFefo<T extends LoteCandidato>(lotes: readonly T[]): T[] {
  return [...lotes].sort(
    (a, b) =>
      Number(a.esSinAsignar) - Number(b.esSinAsignar) ||
      compararVencimiento(a.vence, b.vence) ||
      compararTexto(a.primerIngreso, b.primerIngreso) ||
      compararTexto(a.loteId, b.loteId),
  );
}

const compararVencimiento = (a: string | null, b: string | null): number =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : compararTexto(a, b);

/**
 * Reparte `unidades` (> 0) de una salida entre los lotes. Devuelve las asignaciones POSITIVAS (lo que sale de cada lote) en el orden en que
 * se toman; lo que no cubre ningún lote real va al «sin asignar» (que existe siempre para el artículo con control). `nombrado`: el lote que
 * la persona eligió (baja por vencimiento); sale primero y el resto sigue el orden común.
 */
export function elegirLotesParaSalida(
  candidatos: readonly LoteCandidato[],
  unidades: bigint,
  modo: ModoDeSalida,
  fechaDeNegocio: string,
  nombrado: string | null = null,
): readonly AsignacionDeLote[] {
  if (unidades <= 0n) throw new RangeError("lotes: la cantidad a repartir es mayor que cero");
  const orden = ordenarFefo(candidatos);
  const sinAsignar = orden.find((l) => l.esSinAsignar);
  const reales = orden.filter(
    (l) => !l.esSinAsignar && (modo === "DESCARTE" || esDisponible(l, fechaDeNegocio)),
  );
  const primero = reales.find((l) => l.loteId === nombrado);
  const ordenFinal =
    primero === undefined ? reales : [primero, ...reales.filter((l) => l !== primero)];
  const asignaciones: AsignacionDeLote[] = [];
  let resto = unidades;
  for (const lote of ordenFinal) {
    if (resto === 0n) break;
    if (lote.existencia <= 0n) continue;
    // Stryker disable next-line EqualityOperator: con existencia igual al resto, tomar una u otra da lo mismo
    const toma = lote.existencia < resto ? lote.existencia : resto;
    asignaciones.push({ loteId: lote.loteId, unidades: toma });
    resto -= toma;
  }
  if (resto > 0n) {
    if (sinAsignar === undefined)
      throw new RangeError("lotes: el artículo con control no tiene lote sin asignar");
    // Un «sin asignar» con saldo a favor se consume antes de endeudarlo (es mercadería sin identificar, no deuda).
    asignaciones.push({ loteId: sinAsignar.loteId, unidades: resto });
  }
  return asignaciones;
}

/** La suma de lo asignado: siempre es la cantidad pedida (invariante que la base repite con `Σ saldo_de_lote = saldo_de_stock`). */
export const sumaDeAsignaciones = (asignaciones: readonly AsignacionDeLote[]): bigint =>
  asignaciones.reduce((s, a) => s + a.unidades, 0n);
