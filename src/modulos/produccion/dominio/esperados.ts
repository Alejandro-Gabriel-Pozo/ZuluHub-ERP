import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * Lo esperado de una orden y lo real que se carga al cerrar (E6 §3.2 y §3.3, S-12). Los esperados salen de la explosión de la receta
 * vigente ESCALADA a lo que se quiere producir; se sellan al abrir y no se releen. Al cerrar la persona carga lo REAL de los ingredientes
 * esperados (no suma ingredientes nuevos) y lo obtenido. Puro, en unidades mínimas de cantidad. Previene cerrar con un ingrediente que la
 * orden no tenía o con cantidades negativas, y que lo real se mezcle con una receta que cambió.
 */
export type RenglonEsperado = Readonly<{
  articuloId: string;
  composicionId: string | null;
  unidades: bigint;
}>;
export type ConsumoReal = Readonly<{
  articuloId: string;
  composicionId: string | null;
  unidades: bigint;
}>;

export type ErrorDeCierre = "CONSUMO_FUERA_DE_LA_ORDEN" | "CANTIDAD_INVALIDA" | "CONSUMO_REPETIDO";

const llave = (r: Readonly<{ articuloId: string; composicionId: string | null }>): string =>
  JSON.stringify([r.articuloId, r.composicionId]);

/**
 * Los consumos reales del cierre: cada uno es de un renglón esperado (mismo artículo y versión), no se repite y no es negativo (cero es
 * válido: no se usó). Un esperado que no viene queda en cero. Devuelve los reales en el orden de los esperados.
 */
export function completarConsumos(
  esperados: readonly RenglonEsperado[],
  reales: readonly ConsumoReal[],
): Resultado<readonly ConsumoReal[], ErrorDeCierre> {
  const delaOrden = new Set(esperados.map(llave));
  const porLlave = new Map<string, ConsumoReal>();
  for (const real of reales) {
    if (real.unidades < 0n) return err("CANTIDAD_INVALIDA");
    if (!delaOrden.has(llave(real))) return err("CONSUMO_FUERA_DE_LA_ORDEN");
    if (porLlave.has(llave(real))) return err("CONSUMO_REPETIDO");
    porLlave.set(llave(real), real);
  }
  return ok(
    esperados.map(
      (e) =>
        porLlave.get(llave(e)) ?? {
          articuloId: e.articuloId,
          composicionId: e.composicionId,
          unidades: 0n,
        },
    ),
  );
}

/** La merma de lote: lo esperado menos lo obtenido, en unidades mínimas (negativa si se obtuvo de más). */
export const mermaDeLote = (esperado: bigint, obtenido: bigint): bigint => esperado - obtenido;

/** ¿La receta cambió desde que se abrió la orden? `recetaCambiada` de la consulta: hay una versión posterior a la sellada. */
export const recetaCambiada = (numeroSellado: number, numeroVigente: number): boolean =>
  numeroVigente > numeroSellado;
