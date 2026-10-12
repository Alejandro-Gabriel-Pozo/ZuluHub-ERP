import type { Marca } from "../identificadores/marca";
import { err, ok, type Resultado } from "../resultado/resultado";

/**
 * Hora del día `HH:MM` (reloj de 24 horas, sin segundos: la columna `time` de la base lleva un
 * `CHECK` de segundos en cero). Sirve de hora de corte de la jornada. Valor puro.
 */
export type HoraDelDia = Marca<string, "HoraDelDia">;

export type ErrorDeHoraDelDia = "HORA_DEL_DIA_INVALIDA";

/** Sin corrimiento: la jornada coincide con el día civil. */
export const HORA_DE_CORTE_POR_DEFECTO = "00:00" as HoraDelDia;

/** Estricto: dos dígitos de hora (00 a 23), dos puntos y dos dígitos de minutos (00 a 59). */
const FORMATO = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

export function horaDelDiaDesdeTexto(texto: string): Resultado<HoraDelDia, ErrorDeHoraDelDia> {
  return FORMATO.test(texto) ? ok(texto as HoraDelDia) : err("HORA_DEL_DIA_INVALIDA");
}

/** Minutos desde la medianoche (0 a 1439). */
export function minutosDelDia(hora: HoraDelDia): number {
  const [horas, minutos] = hora.split(":").map(Number) as [number, number];
  return horas * 60 + minutos;
}
