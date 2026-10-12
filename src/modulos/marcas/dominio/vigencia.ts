/**
 * Vigencia de las versiones de marca: «la última decisión manda» (marcas y planes, §B.5.6). Rige la de
 * MAYOR NÚMERO entre las que ya empezaron (`vigenteDesde <= ahora`). Es una semántica distinta a propósito
 * de la del fiscal (`versionVigente` de `modulos/fiscal`, que gana por mayor vigencia): acá, para anular
 * una versión futura se confirma otra, y el número manda sobre la fecha.
 */

/** La base tolera un minuto de reloj entre servidores al exigir que la vigencia no sea retroactiva. */
export const TOLERANCIA_DE_RELOJ_EN_MS = 60_000;

export type VersionConVigencia = Readonly<{ numero: number; vigenteDesde: Date }>;

/**
 *  - `VIGENTE`: la que rige ahora;
 *  - `ANTERIOR`: rigió y otra más nueva ya la reemplazó;
 *  - `PROGRAMADA`: todavía no empezó y va a regir;
 *  - `SIN_EFECTO`: nunca va a regir: cuando empieza, ya hay una de número mayor que empezó antes o a la
 *    vez (una decisión nueva deja sin efecto a las programadas anteriores).
 */
export type EstadoDeVigencia = "VIGENTE" | "ANTERIOR" | "PROGRAMADA" | "SIN_EFECTO";

const instante = (version: VersionConVigencia): number => version.vigenteDesde.getTime();

/** Cada versión con su estado a `ahora`, en el orden en que vienen. */
export function estadosDeVigencia<V extends VersionConVigencia>(
  versiones: readonly V[],
  ahora: Date,
): readonly (V & Readonly<{ estado: EstadoDeVigencia }>)[] {
  const vigente = versionVigente(versiones, ahora);
  return versiones.map((version) => {
    const quedaPisada = versiones.some(
      (otra) => otra.numero > version.numero && instante(otra) <= instante(version),
    );
    const estado: EstadoDeVigencia = quedaPisada
      ? "SIN_EFECTO"
      : instante(version) > ahora.getTime()
        ? "PROGRAMADA"
        : vigente === version
          ? "VIGENTE"
          : "ANTERIOR";
    return { ...version, estado };
  });
}

/** La versión que rige a `ahora`: la de mayor número entre las que ya empezaron, o `null` si ninguna. */
export function versionVigente<V extends VersionConVigencia>(
  versiones: readonly V[],
  ahora: Date,
): V | null {
  let vigente: V | null = null;
  for (const version of versiones) {
    if (
      instante(version) <= ahora.getTime() &&
      (vigente === null || version.numero > vigente.numero)
    ) {
      vigente = version;
    }
  }
  return vigente;
}

/** ¿Hay una versión programada que va a regir en el futuro? Cambiarla a ciegas exige `reemplazaProgramada`. */
export const hayProgramadaPendiente = (
  versiones: readonly VersionConVigencia[],
  ahora: Date,
): boolean => estadosDeVigencia(versiones, ahora).some((v) => v.estado === "PROGRAMADA");
