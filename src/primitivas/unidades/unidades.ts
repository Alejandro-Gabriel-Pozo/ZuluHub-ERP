/**
 * Lista cerrada de unidades de medida: código, dimensión y factor ENTERO a la unidad base de su dimensión (la más chica).
 * Es la copia en código de la tabla `unidad_de_medida` que siembra la migración de E2 (una prueba las compara). Fuente:
 * `catalogo-y-stock-diseno-de-datos.md` (dimensiones sembradas y semilla). Los factores no cambian nunca: cambiar uno
 * revaluaría en silencio toda la historia. Una dimensión tiene una sola base (factor 1).
 */
export type Dimension = "CONTEO" | "MASA" | "VOLUMEN" | "LONGITUD" | "SUPERFICIE" | "TIEMPO";

export const UNIDADES = {
  UNIDAD: { dimension: "CONTEO", factor: 1n },
  GRAMO: { dimension: "MASA", factor: 1n },
  KILOGRAMO: { dimension: "MASA", factor: 1_000n },
  TONELADA: { dimension: "MASA", factor: 1_000_000n },
  MILILITRO: { dimension: "VOLUMEN", factor: 1n },
  LITRO: { dimension: "VOLUMEN", factor: 1_000n },
  METRO_CUBICO: { dimension: "VOLUMEN", factor: 1_000_000n },
  MILIMETRO: { dimension: "LONGITUD", factor: 1n },
  CENTIMETRO: { dimension: "LONGITUD", factor: 10n },
  METRO: { dimension: "LONGITUD", factor: 1_000n },
  CENTIMETRO_CUADRADO: { dimension: "SUPERFICIE", factor: 1n },
  METRO_CUADRADO: { dimension: "SUPERFICIE", factor: 10_000n },
  MINUTO: { dimension: "TIEMPO", factor: 1n },
  HORA: { dimension: "TIEMPO", factor: 60n },
} as const satisfies Record<string, { readonly dimension: Dimension; readonly factor: bigint }>;

export type CodigoDeUnidad = keyof typeof UNIDADES;
