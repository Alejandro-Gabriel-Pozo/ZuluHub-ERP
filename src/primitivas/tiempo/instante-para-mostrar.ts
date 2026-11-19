import { ZONA_DE_ARGENTINA } from "./fecha-civil-hasta-hoy";
import { fechaCivilDesdeTexto } from "./fecha-civil";
import { fechaParaMostrar } from "./fecha-para-mostrar";

/**
 * EL INSTANTE QUE VE EL CLIENTE, en la zona de Argentina: «21:14» y «17/11/2026 21:14» (fecha DD/MM/AAAA, decisión del dueño, fila 178; reloj de 24 horas). Recibe el instante
 * como texto ISO 8601 con zona (`2026-11-18T00:30:00.000Z`, lo que entregan las lecturas del servidor) y lo lleva a la hora de pared de `ZONA_DE_ARGENTINA` con `Intl`, sin restar
 * tres horas a mano y sin depender de la zona del proceso o del navegador. FALLA CERRADA: un texto que no es un instante ISO con zona lanza, nunca muestra un valor a medias. La
 * jornada («Jornada 17/11/2026») NO sale de acá: es una fecha de negocio y se muestra con `fechaParaMostrar`. Puro: sin reloj ni azar.
 * Previene: una hora mostrada en UTC (tres horas corrida) o en la zona de quien mira. Chequeo: `instante-para-mostrar.test.ts` (00:30 UTC es 21:30 del día anterior; 03:00 UTC es 00:00).
 */

const ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

const FORMATEADOR = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONA_DE_ARGENTINA,
  calendar: "gregory",
  numberingSystem: "latn",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function partesDe(instanteIso: string) {
  const instante = new Date(instanteIso);
  if (!ISO_CON_ZONA.test(instanteIso) || Number.isNaN(instante.getTime())) {
    throw new RangeError("instante: no es un instante ISO 8601 con zona");
  }
  const partes: Record<string, string> = {};
  for (const { type, value } of FORMATEADOR.formatToParts(instante)) partes[type] = value;
  return partes as Record<"year" | "month" | "day" | "hour" | "minute", string>;
}

/** «21:14». */
export function horaParaMostrar(instanteIso: string): string {
  const p = partesDe(instanteIso);
  return `${p.hour}:${p.minute}`;
}

/** «17/11/2026 21:14». */
export function fechaYHoraParaMostrar(instanteIso: string): string {
  const p = partesDe(instanteIso);
  const fecha = fechaCivilDesdeTexto(`${p.year}-${p.month}-${p.day}`);
  if (!fecha.ok) throw new RangeError("instante: fecha fuera de rango");
  return `${fechaParaMostrar(fecha.valor)} ${p.hour}:${p.minute}`;
}
