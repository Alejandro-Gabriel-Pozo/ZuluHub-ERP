import { cantidadDesdeTexto, type Cantidad } from "../../../primitivas/cantidad/cantidad";
import type { CantidadConSigno } from "../../../primitivas/cantidad/con-signo";
import { formatearDecimalFijo } from "../../../primitivas/cantidad/decimal-fijo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * El libro de movimientos de stock (E5 §3.1 y §3.2): las clases (cerradas: las entiende el núcleo), qué signo lleva el renglón de cada
 * una, cuándo un movimiento es coherente y cuándo es el espejo exacto de otro. Puro: sin reloj ni azar. Los signos y la coherencia los
 * repite la base (`movimiento_coherente`, diferido, y los CHECK del renglón): una prueba de integración compara las dos. Previene un
 * movimiento que la base rechazaría recién al confirmar y una transferencia que crea o pierde mercadería.
 */
export const CLASES_DE_MOVIMIENTO = [
  "ENTRADA",
  "SALIDA",
  "TRANSFERENCIA",
  "AJUSTE",
  "AJUSTE_POR_CONTEO",
  "ANULACION",
] as const;
export type ClaseDeMovimiento = (typeof CLASES_DE_MOVIMIENTO)[number];

export const esClaseDeMovimiento = (texto: string): texto is ClaseDeMovimiento =>
  (CLASES_DE_MOVIMIENTO as readonly string[]).includes(texto);

/**
 * La escala de las cantidades del libro (`numeric(18,4)`) sale de la primitiva, no se repite: `UNIDADES_POR_ENTERO` es lo que vale 1 en
 * unidades mínimas y `cantidadDeUnidades` vuelve de unidades mínimas a `Cantidad` (lanza `ErrorDeValor` fuera de rango: un defecto).
 */
export const UNIDADES_POR_ENTERO = cantidadDesdeTexto("1").unidades;
export const DECIMALES_DE_CANTIDAD = UNIDADES_POR_ENTERO.toString().length - 1;
export const cantidadDeUnidades = (unidades: bigint): Cantidad =>
  cantidadDesdeTexto(formatearDecimalFijo(unidades, DECIMALES_DE_CANTIDAD));

/** Los orígenes que conoce E5: lo manual (pantallas de stock), el ejemplar de un ticket (ventas) y la recepción (E9, D135). */
export const ORIGEN_MANUAL = "MANUAL";
export const ORIGEN_EJEMPLAR_DE_TICKET = "EJEMPLAR_DE_TICKET";
export const ORIGEN_RECEPCION = "RECEPCION";

/**
 * El signo de cada renglón por clase: la entrada suma (> 0), la salida resta (< 0); la transferencia, los ajustes y la anulación llevan
 * los dos (la transferencia resta en el origen y suma en el destino). Un renglón nunca vale cero.
 */
const SIGNO_VALIDO: Readonly<Record<ClaseDeMovimiento, (unidades: bigint) => boolean>> = {
  ENTRADA: (unidades) => unidades > 0n,
  SALIDA: (unidades) => unidades < 0n,
  TRANSFERENCIA: (unidades) => unidades !== 0n,
  AJUSTE: (unidades) => unidades !== 0n,
  AJUSTE_POR_CONTEO: (unidades) => unidades !== 0n,
  ANULACION: (unidades) => unidades !== 0n,
};

export const signoValido = (clase: ClaseDeMovimiento, cantidad: CantidadConSigno): boolean =>
  SIGNO_VALIDO[clase](cantidad.unidades);

/** Las clases que piden detalle escrito (E5 §3.1: «`AJUSTE`/`ANULACION` exigen `detalle`»). */
const CLASES_CON_DETALLE: readonly ClaseDeMovimiento[] = ["AJUSTE", "ANULACION"];

export const exigeDetalle = (clase: ClaseDeMovimiento): boolean =>
  CLASES_CON_DETALLE.includes(clase);

/**
 * Solo se anulan desde stock los movimientos de origen `MANUAL`; una anulación y un ajuste por conteo no se anulan (se corrigen con otro
 * ajuste o conteo). Los de otro origen los revierte su módulo (`ReversionDeStock`). E5 §3.2 `anularMovimiento`.
 */
const CLASES_NO_ANULABLES: readonly ClaseDeMovimiento[] = ["ANULACION", "AJUSTE_POR_CONTEO"];

export const esAnulable = (clase: ClaseDeMovimiento, origenTipo: string): boolean =>
  origenTipo === ORIGEN_MANUAL && !CLASES_NO_ANULABLES.includes(clase);

/** Un renglón del libro: depósito, artículo, versión de composición de la que salió (o `null`) y cantidad con signo en la unidad de stock. */
export type RenglonDeLibro = Readonly<{
  depositoId: string;
  articuloId: string;
  composicionId: string | null;
  cantidad: CantidadConSigno;
}>;

export type ErrorDeCoherencia =
  | "SIN_RENGLONES"
  | "SIGNO_INVALIDO"
  | "RENGLON_REPETIDO"
  | "TRANSFERENCIA_NO_ENTRE_DOS_DEPOSITOS"
  | "TRANSFERENCIA_NO_SUMA_CERO";

const llaveDelRenglon = (r: RenglonDeLibro): string =>
  JSON.stringify([r.depositoId, r.articuloId, r.composicionId]);

/**
 * La coherencia de un movimiento antes de escribirlo (la misma que `movimiento_coherente` y la unicidad del renglón en la base): tiene
 * renglones, cada uno con el signo de su clase y sin repetir (depósito, artículo, composición); una transferencia resta en UN depósito,
 * suma en OTRO distinto y suma cero por artículo. El espejo de una anulación se comprueba aparte (`comprobarEspejo`).
 */
export function comprobarCoherencia(
  clase: ClaseDeMovimiento,
  renglones: readonly RenglonDeLibro[],
): Resultado<null, ErrorDeCoherencia> {
  if (renglones.length === 0) return err("SIN_RENGLONES");
  if (clase === "TRANSFERENCIA" && !entreDosDepositos(renglones)) {
    return err("TRANSFERENCIA_NO_ENTRE_DOS_DEPOSITOS");
  }
  if (!renglones.every((r) => signoValido(clase, r.cantidad))) return err("SIGNO_INVALIDO");
  if (new Set(renglones.map(llaveDelRenglon)).size !== renglones.length) {
    return err("RENGLON_REPETIDO");
  }
  if (clase === "TRANSFERENCIA" && !sumaCeroPorArticulo(renglones)) {
    return err("TRANSFERENCIA_NO_SUMA_CERO");
  }
  return ok(null);
}

/** Todos los renglones que restan están en un depósito, todos los que suman en otro distinto. */
function entreDosDepositos(renglones: readonly RenglonDeLibro[]): boolean {
  const origenes = new Set(
    renglones.filter((r) => r.cantidad.unidades < 0n).map((r) => r.depositoId),
  );
  const destinos = new Set(
    renglones.filter((r) => r.cantidad.unidades > 0n).map((r) => r.depositoId),
  );
  if (origenes.size !== 1 || destinos.size !== 1) return false;
  return [...origenes][0] !== [...destinos][0];
}

function sumaCeroPorArticulo(renglones: readonly RenglonDeLibro[]): boolean {
  const sumas = new Map<string, bigint>();
  for (const r of renglones) {
    // Stryker disable next-line ArithmeticOperator: negar la suma de un artículo no cambia si vale cero, que es lo único que se mira
    sumas.set(r.articuloId, (sumas.get(r.articuloId) ?? 0n) + r.cantidad.unidades);
  }
  return [...sumas.values()].every((suma) => suma === 0n);
}

/**
 * El espejo exacto de una anulación (E5 §3.2): mismos depósitos, artículos y versiones de composición, cantidad de signo contrario. El
 * orden de los renglones no importa. Previene una anulación que devuelve otra cosa que lo que salió.
 */
export function comprobarEspejo(
  original: readonly RenglonDeLibro[],
  anulacion: readonly RenglonDeLibro[],
): boolean {
  if (original.length !== anulacion.length) return false;
  const esperado = new Map(original.map((r) => [llaveDelRenglon(r), -r.cantidad.unidades]));
  if (esperado.size !== original.length) return false;
  return anulacion.every((r) => esperado.get(llaveDelRenglon(r)) === r.cantidad.unidades);
}

/**
 * Orden canónico de bloqueos: por (depósito, artículo, composición) con `null` primero. Todos los movimientos toman los bloqueos de saldo
 * en el mismo orden, así dos transferencias cruzadas no se traban entre sí (E5 §3.2). Devuelve una copia.
 */
export function ordenarParaBloqueo(renglones: readonly RenglonDeLibro[]): RenglonDeLibro[] {
  return [...renglones].sort(
    (a, b) =>
      compararTexto(a.depositoId, b.depositoId) ||
      compararTexto(a.articuloId, b.articuloId) ||
      compararTexto(a.composicionId ?? "", b.composicionId ?? ""),
  );
}

/** Orden de texto por unidades de código, igual en cualquier máquina (no depende del idioma): el que usan los bloqueos y las explosiones. */
export const compararTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
