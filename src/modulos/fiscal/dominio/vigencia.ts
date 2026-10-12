import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * Versionado con vigencia (spec H7 §B.3, §B.6): los datos fiscales de cada emisor y la regla del
 * emisor se confirman como versiones numeradas e inmutables. Nada se pisa: confirmar una versión
 * nueva no cambia lo que regía antes de su vigencia. «Vigente», «futura» y «reemplazada» no se
 * guardan: se calculan con `ahora`, como «vencida» en las invitaciones.
 *
 * Solo hay versiones CONFIRMADAS acá: un borrador no tiene `numero` ni `vigenteDesde`, así que el
 * tipo mismo impide que cuente como vigente.
 */
export type VersionConfirmada = Readonly<{ numero: number; vigenteDesde: Date }>;

export type EstadoDeVersion = "FUTURA" | "VIGENTE" | "REEMPLAZADA";

export type ErrorDeConfirmacion = "MOTIVO_OBLIGATORIO" | "VIGENCIA_RETROACTIVA";

function milisegundos(fecha: Date): number {
  const ms = fecha.getTime();
  // Una fecha inválida (NaN) haría falsas todas las comparaciones y dejaría pasar cualquier cosa.
  if (Number.isNaN(ms)) throw new RangeError("fecha inválida");
  return ms;
}

/**
 * La versión vigente en `ahora`: la confirmada con mayor (`vigenteDesde`, `numero`) entre las que
 * ya empezaron (`vigenteDesde <= ahora`). `null` si no hay ninguna. Para anular una versión futura
 * se confirma otra con la misma vigencia: gana el número mayor. No depende del orden de la lista.
 */
export function versionVigente<V extends VersionConfirmada>(
  confirmadas: readonly V[],
  ahora: Date,
): V | null {
  const instante = milisegundos(ahora);
  let vigente: V | null = null;
  for (const version of confirmadas) {
    const desde = milisegundos(version.vigenteDesde);
    if (desde > instante) continue;
    if (vigente === null) {
      vigente = version;
      continue;
    }
    const desdeVigente = vigente.vigenteDesde.getTime();
    if (desde > desdeVigente || (desde === desdeVigente && version.numero > vigente.numero)) {
      vigente = version;
    }
  }
  return vigente;
}

/** `FUTURA` si todavía no empezó; `VIGENTE` si es la que rige en `ahora` (se identifica por su número); si no, `REEMPLAZADA`. */
export function estadoDeVersion<V extends VersionConfirmada>(
  confirmadas: readonly V[],
  version: V,
  ahora: Date,
): EstadoDeVersion {
  if (milisegundos(version.vigenteDesde) > milisegundos(ahora)) return "FUTURA";
  return versionVigente(confirmadas, ahora)?.numero === version.numero ? "VIGENTE" : "REEMPLAZADA";
}

/** El número de la próxima versión: el máximo + 1 (la base lo asigna bajo serializable). */
export function siguienteNumeroDeVersion(confirmadas: readonly VersionConfirmada[]): number {
  return confirmadas.reduce((maximo, v) => Math.max(maximo, v.numero), 0) + 1;
}

export type DatosDeConfirmacion = Readonly<{
  ahora: Date;
  /** Desde cuándo rige. No puede ser anterior a `ahora` (sin vigencia retroactiva); puede ser futura. */
  vigenteDesde: Date;
  motivo: string;
}>;

export type ConfirmacionDeVersion = Readonly<{
  numero: number;
  vigenteDesde: Date;
  confirmadaEn: Date;
  motivo: string;
}>;

/**
 * Lo que fija confirmar una versión: su número, su vigencia, el instante de la confirmación y el
 * motivo (recortado). Orden de los errores: motivo obligatorio, después vigencia retroactiva.
 */
export function confirmarVersion(
  existentes: readonly VersionConfirmada[],
  datos: DatosDeConfirmacion,
): Resultado<ConfirmacionDeVersion, ErrorDeConfirmacion> {
  const motivo = datos.motivo.trim();
  if (motivo === "") return err("MOTIVO_OBLIGATORIO");
  if (milisegundos(datos.vigenteDesde) < milisegundos(datos.ahora)) {
    return err("VIGENCIA_RETROACTIVA");
  }
  return ok({
    numero: siguienteNumeroDeVersion(existentes),
    vigenteDesde: datos.vigenteDesde,
    confirmadaEn: datos.ahora,
    motivo,
  });
}
