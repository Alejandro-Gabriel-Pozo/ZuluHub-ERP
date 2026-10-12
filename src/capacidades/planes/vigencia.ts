import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";

/**
 * Vigencia de las decisiones de plataforma sobre planes: asignaciones de plan y ajustes de perilla
 * (marcas y planes, §B.5.6). Regla: «la última decisión manda» — rige la de MAYOR NÚMERO entre las
 * que ya empezaron (`vigenteDesde <= ahora`).
 *
 * Es una regla distinta a propósito de la del fiscal (`versionVigente`: gana la mayor vigencia, y para
 * anular una futura se confirma otra con la misma vigencia). Acá una decisión nueva, por tener mayor
 * número, deja sin efecto a las programadas anteriores que empiecen a la misma hora o después; por eso
 * reemplazar algo programado se pide expresamente. Ninguna decisión se modifica ni se borra: «vigente»,
 * «programada», «sin efecto» y «anterior» se CALCULAN con `ahora`.
 *
 * Pura: sin reloj (la hora entra como dato) ni azar. Una serie es el historial de UNA cosa (las
 * asignaciones de un tenant; los ajustes de una perilla en un tenant o una empresa).
 */

/** Lo mínimo de una decisión de la serie: su número consecutivo y desde cuándo rige. */
export type Decision = Readonly<{ numero: number; vigenteDesde: Date }>;

export type EstadoDeDecision = "VIGENTE" | "PROGRAMADA" | "SIN_EFECTO" | "ANTERIOR";

/**
 * Cuánto se tolera que `vigenteDesde` sea anterior a `ahora` (reloj de otra instancia): un minuto,
 * como la base y H5. Más que eso es una vigencia retroactiva.
 */
export const TOLERANCIA_DE_VIGENCIA_EN_MS = 60_000;

function instante(fecha: Date): number {
  const ms = fecha.getTime();
  // Una fecha inválida (NaN) haría falsas todas las comparaciones y dejaría pasar cualquier cosa.
  if (Number.isNaN(ms)) throw new RangeError("fecha inválida");
  return ms;
}

/**
 * La decisión vigente en `ahora`: la de mayor número entre las que ya empezaron; `null` si ninguna
 * empezó. No depende del orden de la lista.
 */
export function vigenteEn<D extends Decision>(historial: readonly D[], ahora: Date): D | null {
  const t = instante(ahora);
  const empezadas = historial.filter((decision) => instante(decision.vigenteDesde) <= t);
  const mayor = Math.max(...empezadas.map((decision) => decision.numero));
  return empezadas.find((decision) => decision.numero === mayor) ?? null;
}

/**
 * El estado de una decisión de la serie en `ahora`:
 *  - `SIN_EFECTO`: hay otra de mayor número que empieza a la misma hora o antes, así que ésta nunca
 *    rigió ni va a regir;
 *  - `PROGRAMADA`: todavía no empezó y nada la deja sin efecto;
 *  - `VIGENTE`: la que rige ahora;
 *  - `ANTERIOR`: rigió y fue reemplazada por una de mayor número que ya empezó.
 */
export function estadoDeDecision<D extends Decision>(
  historial: readonly D[],
  decision: D,
  ahora: Date,
): EstadoDeDecision {
  const t = instante(ahora);
  const desde = instante(decision.vigenteDesde);
  const posteriores = historial.filter((otra) => otra.numero > decision.numero);
  if (posteriores.some((otra) => instante(otra.vigenteDesde) <= desde)) return "SIN_EFECTO";
  if (desde > t) return "PROGRAMADA";
  return posteriores.some((otra) => instante(otra.vigenteDesde) <= t) ? "ANTERIOR" : "VIGENTE";
}

export type PedidoDeCambio = Readonly<{
  ahora: Date;
  /** Desde cuándo rige la decisión nueva. No puede ser retroactiva (salvo la tolerancia de reloj). */
  vigenteDesde: Date;
  /** El número de la última decisión que vio quien decide; `null` si la serie estaba vacía. */
  numeroEsperado: number | null;
  /** Quien decide sabe que hay una programada y la quiere reemplazar. */
  reemplazaProgramada: boolean;
}>;

export type ErrorDeCambio = Readonly<{
  codigo: "VIGENCIA_RETROACTIVA" | "VERSION_DESACTUALIZADA" | "CAMBIO_PROGRAMADO_PENDIENTE";
}>;

export type CambioDecidido = Readonly<{
  /** El número que lleva la decisión nueva: el último + 1 (la base lo impone bajo serializable). */
  numero: number;
  /** Las programadas (por número, ascendente) que existían antes de decidir. */
  programadasPendientes: readonly number[];
  /** Las programadas que la decisión nueva deja sin efecto: las que empiezan a su hora o después. */
  reemplazadas: readonly number[];
}>;

/**
 * Decide si una decisión nueva entra en la serie y con qué número. Orden de los errores:
 * vigencia retroactiva, versión desactualizada (`numeroEsperado` no es el último), cambio programado
 * pendiente (hay una programada y no se pidió reemplazarla). Una decisión que no es la próxima en la
 * serie no se admite: dos cambios simultáneos desde el mismo punto, uno gana.
 */
export function decidirCambio(
  historial: readonly Decision[],
  pedido: PedidoDeCambio,
): Resultado<CambioDecidido, ErrorDeCambio> {
  const desde = instante(pedido.vigenteDesde);
  if (desde < instante(pedido.ahora) - TOLERANCIA_DE_VIGENCIA_EN_MS) {
    return err({ codigo: "VIGENCIA_RETROACTIVA" });
  }
  const ultimo = historial.reduce((maximo, d) => Math.max(maximo, d.numero), 0);
  const esperadoVigente = historial.length === 0 ? null : ultimo;
  if (pedido.numeroEsperado !== esperadoVigente) return err({ codigo: "VERSION_DESACTUALIZADA" });
  const programadas = historial
    .filter((d) => estadoDeDecision(historial, d, pedido.ahora) === "PROGRAMADA")
    .sort((a, b) => a.numero - b.numero);
  if (programadas.length > 0 && !pedido.reemplazaProgramada) {
    return err({ codigo: "CAMBIO_PROGRAMADO_PENDIENTE" });
  }
  return ok({
    numero: ultimo + 1,
    programadasPendientes: programadas.map((d) => d.numero),
    reemplazadas: programadas.filter((d) => instante(d.vigenteDesde) >= desde).map((d) => d.numero),
  });
}

/** El motivo, recortado, o `null` si está vacío (todo cambio de plataforma lleva su motivo). */
export function motivoValido(motivo: string): string | null {
  const limpio = motivo.trim();
  return limpio === "" ? null : limpio;
}
