import {
  cantidadPorPasos,
  pasosDeLaLinea,
  planDeDivision,
  totalesDeLaDivision,
  type Asignacion,
  type LineaADividir,
} from "../../../../../src/primitivas/cuentas/division";
import { MAXIMO_DE_CUENTAS_POR_ITEMS } from "../../../../../src/primitivas/cuentas/limites-de-division";
import { formatearCantidad, formatearImporte } from "../../patrones/formato-fiscal";

/**
 * El modelo de vista de «Dividir la cuenta» por ítems (SAL-E2, S11): el borrador de reparto que arma la persona y lo que se ve de él. Puro: sin React ni servidor.
 * El reparto y los importes NO se calculan acá: son los de `primitivas/cuentas/division.ts` (`planDeDivision` y `totalesDeLaDivision`), los mismos que usa el servidor al confirmar (el centavo que sobra va a la Cuenta 1).
 * Cada línea va ENTERA a una cuenta, POR UNIDADES (cada paso de cantidad a una cuenta) o COMPARTIDA en partes iguales entre las cuentas elegidas; sin dato, la línea queda «Falta asignar» y una cuenta sin nada, «Cuenta vacía»:
 * en cualquiera de los dos casos no se confirma. Previene: dos pantallas que reparten distinto el mismo total y una división a medias. Chequeo: `test/web/salon-dividir-modelo.test.ts`.
 */
export type Forma = "ENTERO" | "POR_UNIDADES" | "COMPARTIDO";

/** Una línea de la cuenta, tal como se reparte (el dinero y la cantidad, como texto decimal). */
export type LineaParaDividir = Readonly<{
  lineaId: string;
  /** «2 × Milanesa · Grande». */
  nombre: string;
  /** «$ 1.234,56». */
  importe: string;
  cantidad: string;
  pasoDeCantidad: string;
  precioUnitario: string;
  /** Cuántos pasos tiene la línea (lo que se reparte «Por unidades»); `null` si no se puede repartir por unidades. */
  pasos: number | null;
}>;

/** Lo elegido para una línea: la cuenta (entero), la cuenta de cada paso (por unidades; 0 = sin elegir) o las cuentas entre las que se comparte. */
export type Reparto = Readonly<{
  forma: Forma;
  parte: number;
  pasos: readonly number[];
  partes: readonly number[];
}>;

export type Borrador = Readonly<{
  cuentas: number;
  repartos: Readonly<Record<string, Reparto | undefined>>;
}>;

/** Una cuenta hija de una mesa dividida («Cuenta 1 · $ 100,00 · Pendiente»): se cobra sola, con todos sus platos enviados y su total en pesos. */
export type CuentaHijaArmada = Readonly<{
  cuentaId: string;
  /** «Cuenta 1». */
  titulo: string;
  /** «$ 1.234,56»; `null` si su moneda no es ARS. */
  importe: string | null;
  totalACobrar: Readonly<{ moneda: string; monto: string }> | null;
  cobrada: boolean;
  /** Se le ofrece «Cobrar»: sin cobrar, con platos y todos enviados. */
  cobrable: boolean;
}>;

/** Dos cuentas de entrada: el mínimo para dividir (el máximo es el de la primitiva de límites). */
export const BORRADOR_INICIAL: Borrador = { cuentas: 2, repartos: {} };

/** Más pasos que estos no se reparten «Por unidades» (una fila por paso): el botón queda apagado. */
export const MAXIMO_DE_PASOS_A_REPARTIR = 30;

export const puedeAgregarCuenta = (b: Borrador): boolean => b.cuentas < MAXIMO_DE_CUENTAS_POR_ITEMS;

export const conUnaCuentaMas = (b: Borrador): Borrador =>
  puedeAgregarCuenta(b) ? { ...b, cuentas: b.cuentas + 1 } : b;

/** Las líneas de la ficha, listas para repartir. */
export function lineasParaDividir(
  lineas: readonly Readonly<{
    lineaId: string;
    descripcion: string;
    varianteNombre: string | null;
    cantidad: string;
    precioUnitario: string;
    pasoDeCantidad: string;
    importe: string;
  }>[],
): readonly LineaParaDividir[] {
  return lineas.map((l) => {
    const pasos = pasosDeLaLinea(l.cantidad, l.pasoDeCantidad);
    return {
      lineaId: l.lineaId,
      nombre: `${formatearCantidad(l.cantidad)} × ${l.descripcion}${l.varianteNombre === null ? "" : ` · ${l.varianteNombre}`}`,
      importe: formatearImporte(l.importe),
      cantidad: l.cantidad,
      pasoDeCantidad: l.pasoDeCantidad,
      precioUnitario: l.precioUnitario,
      pasos: pasos !== null && pasos >= 2 && pasos <= MAXIMO_DE_PASOS_A_REPARTIR ? pasos : null,
    };
  });
}

const sinElegir = (forma: Forma, l: LineaParaDividir): Reparto => ({
  forma,
  parte: 0,
  pasos: Array.from({ length: l.pasos ?? 0 }, () => 0),
  partes: [],
});

/** Cambia la forma de una línea: lo elegido antes se descarta (cada forma empieza sin elegir). */
export const conLaForma = (b: Borrador, l: LineaParaDividir, forma: Forma): Borrador => ({
  ...b,
  repartos: { ...b.repartos, [l.lineaId]: sinElegir(forma, l) },
});

const reparto = (b: Borrador, l: LineaParaDividir, forma: Forma): Reparto => {
  const actual = b.repartos[l.lineaId];
  return actual?.forma === forma ? actual : sinElegir(forma, l);
};

export const conLaCuentaEntera = (b: Borrador, l: LineaParaDividir, parte: number): Borrador => ({
  ...b,
  repartos: { ...b.repartos, [l.lineaId]: { ...reparto(b, l, "ENTERO"), parte } },
});

export const conLaCuentaDelPaso = (
  b: Borrador,
  l: LineaParaDividir,
  paso: number,
  parte: number,
): Borrador => {
  const actual = reparto(b, l, "POR_UNIDADES");
  return {
    ...b,
    repartos: {
      ...b.repartos,
      [l.lineaId]: { ...actual, pasos: actual.pasos.map((p, i) => (i === paso ? parte : p)) },
    },
  };
};

/** Suma o saca una cuenta de las que comparten la línea. */
export const conLaCuentaCompartida = (
  b: Borrador,
  l: LineaParaDividir,
  parte: number,
): Borrador => {
  const actual = reparto(b, l, "COMPARTIDO");
  const partes = actual.partes.includes(parte)
    ? actual.partes.filter((p) => p !== parte)
    : [...actual.partes, parte].sort((x, y) => x - y);
  return { ...b, repartos: { ...b.repartos, [l.lineaId]: { ...actual, partes } } };
};

const dentro = (n: number, cuentas: number): boolean =>
  Number.isSafeInteger(n) && n >= 1 && n <= cuentas;

/** La asignación de una línea si está completa (todo elegido y dentro de las cuentas); `null` si falta algo. */
function asignacionDe(
  cuentas: number,
  l: LineaParaDividir,
  r: Reparto | undefined,
): Asignacion | null {
  if (r === undefined) return null;
  if (r.forma === "ENTERO") {
    return dentro(r.parte, cuentas)
      ? { lineaId: l.lineaId, forma: "ENTERO", parte: r.parte }
      : null;
  }
  if (r.forma === "COMPARTIDO") {
    return r.partes.length >= 2 && r.partes.every((p) => dentro(p, cuentas))
      ? { lineaId: l.lineaId, forma: "COMPARTIDO", partes: r.partes }
      : null;
  }
  if (l.pasos === null || r.pasos.length !== l.pasos || !r.pasos.every((p) => dentro(p, cuentas))) {
    return null;
  }
  const cantidades = Array.from({ length: cuentas }, (_, i) =>
    cantidadPorPasos(l.pasoDeCantidad, r.pasos.filter((p) => p === i + 1).length),
  );
  return cantidades.every((c) => c !== null)
    ? { lineaId: l.lineaId, forma: "POR_UNIDADES", cantidades }
    : null;
}

export type Evaluacion = Readonly<{
  /** Lo que se manda al servidor si está todo asignado; vacío si falta algo. */
  asignaciones: readonly Asignacion[];
  /** Las líneas que todavía no se repartieron del todo («Falta asignar»). */
  sinAsignar: ReadonlySet<string>;
  /** Las cuentas sin nada, solo cuando todas las líneas están repartidas («Cuenta vacía»). */
  vacias: readonly number[];
  /** Lo que suma cada cuenta («$ 2.000,34»), cuando el reparto está completo y es válido; `null` si no. */
  totales: readonly string[] | null;
  /** Se puede confirmar: todo repartido, ninguna cuenta vacía y el plan es válido. */
  lista: boolean;
}>;

export function evaluarLaDivision(b: Borrador, lineas: readonly LineaParaDividir[]): Evaluacion {
  const asignaciones: Asignacion[] = [];
  const sinAsignar = new Set<string>();
  for (const l of lineas) {
    const a = asignacionDe(b.cuentas, l, b.repartos[l.lineaId]);
    if (a === null) sinAsignar.add(l.lineaId);
    else asignaciones.push(a);
  }
  if (sinAsignar.size > 0) {
    return { asignaciones: [], sinAsignar, vacias: [], totales: null, lista: false };
  }
  const usadas = new Set<number>();
  for (const a of asignaciones) {
    if (a.forma === "ENTERO") usadas.add(a.parte);
    else if (a.forma === "COMPARTIDO") for (const p of a.partes) usadas.add(p);
    else
      a.cantidades.forEach((c, i) => {
        if (/[1-9]/.test(c)) usadas.add(i + 1);
      });
  }
  const vacias = Array.from({ length: b.cuentas }, (_, i) => i + 1).filter((n) => !usadas.has(n));
  const aDividir: readonly LineaADividir[] = lineas.map((l) => ({
    lineaId: l.lineaId,
    cantidad: l.cantidad,
    pasoDeCantidad: l.pasoDeCantidad,
    precioUnitario: l.precioUnitario,
  }));
  const plan = planDeDivision({ partes: b.cuentas, lineas: aDividir, asignaciones });
  const totales = plan.ok ? totalesDeLaDivision(b.cuentas, aDividir, plan.valor) : null;
  return {
    asignaciones,
    sinAsignar,
    vacias,
    totales: totales === null ? null : totales.map((t) => formatearImporte(t)),
    lista: plan.ok && totales !== null && vacias.length === 0,
  };
}
