import { createHash } from "node:crypto";

/**
 * Las celdas de un oráculo de casos de uso: la lista esperada de lo que el sistema puede y no puede hacer (decisión del dueño, 2026-11-14:
 * «lo que una cosa no puede, no debe o no hace sale de lo que ES»). Una celda cruza acción × estado de partida × condición y dice si se
 * permite, con qué error, qué regla y qué decisión la respaldan y quién la impone (la base o el caso de uso). Las tablas de cada módulo
 * (`ventas/dominio/oraculo-de-ticket.ts`, `fiscal/dominio/oraculo-de-comprobante.ts`) usan este tipo y estas funciones: la forma de una celda y
 * sus controles viven acá una sola vez. Puro; sin reloj ni azar.
 * Previene: la «regla sin clasificar» (`documento_vigente_uk`, un índice único que impuso una política como si fuera invariante): una celda sin
 * regla y sin decisión no entra, y una celda cuyo caso de uso hoy difiere queda marcada `PENDIENTE (tramo X)` en vez de pasar en silencio.
 */

/** Lo que hace el código de hoy frente a la celda: coincide, hace otra cosa, o el caso de uso todavía no existe. */
export const HOY_DE_UNA_CELDA = ["COINCIDE", "DIFIERE", "NO_EXISTE"] as const;
export type HoyDeUnaCelda = (typeof HOY_DE_UNA_CELDA)[number];

/** Quién impone la celda: un disparador o una restricción de la base, el caso de uso, o los dos. */
export const QUIEN_IMPONE = ["base", "codigo", "base+codigo"] as const;
export type QuienImpone = (typeof QUIEN_IMPONE)[number];

export type TransicionDeEstado<E extends string> = Readonly<{ de: E; a: E }>;

export type CeldaDeOraculo<Id extends string = string, E extends string = string> = Readonly<{
  id: Id;
  /** Qué se intenta (o, en un caso de dos acciones a la vez, el caso). */
  accion: string;
  /** El estado de partida y la condición que cambia el resultado, en palabras del negocio. */
  partida: string;
  permitido: boolean;
  /** Los códigos de error con nombre que el sistema devuelve hoy en esta celda; vacío si se permite o si el nombre todavía no existe. */
  errores: readonly string[];
  /** Lo que pasa o lo que se espera, en una línea (incluye los nombres a definir de las celdas pendientes). */
  resultado: string;
  /** Las reglas (ids del piloto `VF-R-nn`, `R-07a/b/c`, `INV-…`, `D-nn`) que la respaldan: sin regla, la celda no entra. */
  regla: string;
  /** La decisión del dueño o el documento que la respalda. */
  decision: string;
  quien: QuienImpone;
  hoy: HoyDeUnaCelda;
  /** El tramo que la construye (`T0`, `C2`…); `null` si hoy coincide. Mientras no es `null`, la celda no se ejecuta contra el código. */
  pendiente: string | null;
  /** Una celda que el dueño pidió revisar: no se toca nada hasta que cuente el caso. */
  enRevision?: true;
  /** Las transiciones de estado que esta celda ejerce; `permitido` dice si la máquina de estados las admite. */
  transiciones?: readonly TransicionDeEstado<E>[];
}>;

/** La etiqueta de una celda que todavía no se ejecuta, tal como se escribe en el título de su prueba. */
export function etiquetaDePendiente(celda: Pick<CeldaDeOraculo, "pendiente">): string | null {
  return celda.pendiente === null ? null : `PENDIENTE (tramo ${celda.pendiente})`;
}

/** Las celdas que se ejecutan contra el caso de uso real: las que hoy coinciden. */
export function celdasEjecutables<C extends CeldaDeOraculo>(celdas: readonly C[]): readonly C[] {
  return celdas.filter((c) => c.hoy === "COINCIDE");
}

/** Las celdas que esperan su tramo. */
export function celdasPendientes<C extends CeldaDeOraculo>(celdas: readonly C[]): readonly C[] {
  return celdas.filter((c) => c.hoy !== "COINCIDE");
}

/** Una celda por su id; falla si no está (un id mal escrito en una prueba no pasa en silencio). */
export function celdaPor<C extends CeldaDeOraculo>(celdas: readonly C[], id: C["id"]): C {
  const celda = celdas.find((c) => c.id === id);
  if (celda === undefined) throw new Error(`el oráculo no tiene la celda ${id}`);
  return celda;
}

/**
 * Los defectos de forma de una tabla de celdas, con el id de la celda: id repetido, sin regla o sin decisión, `pendiente` que no cuadra con
 * `hoy`, una celda permitida con errores o una celda que hoy coincide y se rechaza sin ningún código. Lista vacía = la tabla es válida.
 */
export function defectosDeForma(celdas: readonly CeldaDeOraculo[]): readonly string[] {
  const defectos: string[] = [];
  const vistos = new Set<string>();
  for (const c of celdas) {
    if (vistos.has(c.id)) defectos.push(`${c.id}: id repetido`);
    vistos.add(c.id);
    if (c.regla.trim() === "") defectos.push(`${c.id}: sin regla`);
    if (c.decision.trim() === "") defectos.push(`${c.id}: sin decisión`);
    if (c.hoy === "COINCIDE" && c.pendiente !== null)
      defectos.push(`${c.id}: coincide y tiene tramo`);
    if (c.hoy !== "COINCIDE" && (c.pendiente === null || c.pendiente.trim() === "")) {
      defectos.push(`${c.id}: no coincide y no dice su tramo`);
    }
    if (c.permitido && c.errores.length > 0) defectos.push(`${c.id}: permitida con errores`);
    if (c.hoy === "COINCIDE" && !c.permitido && c.errores.length === 0 && c.quien === "codigo") {
      defectos.push(`${c.id}: rechazada por el código sin código de error`);
    }
  }
  return defectos;
}

/**
 * Las transiciones de estado que el oráculo permite, agrupadas por estado de partida, en el mismo formato que las tablas `TRANSICIONES_DE_*`
 * para poder compararlas con ellas (el oráculo las DERIVA de sus celdas y se compara con la tabla del dominio y con la base: no son tres listas
 * escritas aparte). Cada lista sale ordenada y sin repetidos.
 */
export function transicionesPermitidas<E extends string>(
  celdas: readonly CeldaDeOraculo<string, E>[],
  estados: readonly E[],
): Readonly<Record<E, readonly E[]>> {
  const salida = Object.fromEntries(estados.map((e) => [e, new Set<E>()])) as Record<E, Set<E>>;
  for (const celda of celdas) {
    if (!celda.permitido) continue;
    for (const t of celda.transiciones ?? []) salida[t.de].add(t.a);
  }
  return Object.fromEntries(estados.map((e) => [e, [...salida[e]].sort()])) as unknown as Readonly<
    Record<E, readonly E[]>
  >;
}

/** Las transiciones que alguna celda declara NO permitidas (lo que el oráculo prohíbe expresamente), como pares `de>a`. */
export function transicionesProhibidas<E extends string>(
  celdas: readonly CeldaDeOraculo<string, E>[],
): readonly string[] {
  const pares = new Set<string>();
  for (const celda of celdas) {
    if (celda.permitido) continue;
    for (const t of celda.transiciones ?? []) pares.add(`${t.de}>${t.a}`);
  }
  return [...pares].sort();
}

/** Los códigos de error con nombre que figuran en alguna celda: lo que la regla de arquitectura de errores reconoce como cubierto por el oráculo. */
export function codigosDeLasCeldas(celdas: readonly CeldaDeOraculo[]): ReadonlySet<string> {
  return new Set(celdas.flatMap((c) => c.errores));
}

/**
 * La huella de una tabla de celdas: SHA-256 de su JSON. La prueba de cada oráculo la compara con una constante: cambiar una celda exige
 * actualizar la huella en el mismo cambio (se ve en el diff) y ningún literal de la tabla puede cambiar sin que una prueba lo note.
 */
export function huellaDeLasCeldas(celdas: readonly CeldaDeOraculo[]): string {
  return createHash("sha256").update(JSON.stringify(celdas)).digest("hex");
}
