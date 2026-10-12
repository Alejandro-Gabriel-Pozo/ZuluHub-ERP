import { err, ok, type Resultado } from "../resultado/resultado";
import type { FechaCivil } from "./fecha-civil";
import { horaDelDiaDesdeTexto, minutosDelDia } from "./hora-del-dia";

/**
 * Fecha de negocio (la jornada): la fecha civil de `(instante en la zona de la empresa) − hora de
 * corte`. Con corte 00:00 es el día civil local; con corte 04:00, lo que pasa entre las 00:00 y las
 * 03:59 pertenece a la jornada del día anterior. Es la misma fórmula que aplica la base
 * (`((instante AT TIME ZONE zona) - corte)::date`) para caja, ventas y stock.
 *
 * Valor puro: el instante entra como parámetro (nunca se lee el reloj) y no hay azar ni I/O.
 * Usa `Intl.DateTimeFormat`, sin dependencias. La zona no tiene horario de verano en Argentina,
 * pero la fórmula es general: cada instante se lleva a la hora de pared de SU zona.
 */
export type ErrorDeJornada =
  "HORA_DE_CORTE_INVALIDA" | "ZONA_HORARIA_INVALIDA" | "INSTANTE_INVALIDO";

/**
 * Rango de instantes que dan una fecha de negocio de año 0001 a 9999 en cualquier zona (que se
 * corre hasta 14 horas, más el corte de hasta un día): un instante fuera de él, o inválido (`NaN`),
 * no tiene fecha de negocio representable.
 */
export const INSTANTE_MINIMO = Date.parse("0001-01-03T00:00:00Z");
export const INSTANTE_MAXIMO = Date.parse("9999-12-30T00:00:00Z");

/**
 * Nombre canónico de la base de zonas horarias (IANA): `UTC` o varios segmentos con mayúscula
 * inicial separados por `/` (`America/Argentina/Buenos_Aires`, `Etc/GMT+3`). Deja afuera lo que
 * `Intl` acepta de más y que la base interpretaría distinto o no aceptaría: desfases (`+03:00`,
 * que en Postgres se lee con el signo invertido), siglas (`EST`) y variantes de mayúsculas.
 */
const FORMATO_DE_ZONA = /^(?:UTC|[A-Z][A-Za-z0-9_+-]*(?:\/[A-Z][A-Za-z0-9_+-]*)+)$/;

function formateadorDeZona(zonaHoraria: string): Intl.DateTimeFormat | null {
  if (!FORMATO_DE_ZONA.test(zonaHoraria)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zonaHoraria,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
  } catch {
    // `Intl` lanza RangeError ante una zona que no existe: es un error previsto, no un fallo.
    return null;
  }
}

/** Las partes de la fecha formateada (año, mes, día, hora, minuto) como números, por tipo. */
function numerosPorTipo(formateador: Intl.DateTimeFormat, instante: Date) {
  const valores: Record<string, number> = {};
  for (const { type, value } of formateador.formatToParts(instante)) valores[type] = Number(value);
  return valores as Record<"year" | "month" | "day" | "hour" | "minute", number>;
}

/**
 * Valida en este orden: hora de corte, zona horaria e instante; devuelve el primer error. Los
 * segundos del instante no cuentan: la jornada cambia exactamente a la hora de corte en punto.
 */
export function fechaDeNegocio(
  instante: Date,
  zonaHoraria: string,
  horaDeCorte: string,
): Resultado<FechaCivil, ErrorDeJornada> {
  const corte = horaDelDiaDesdeTexto(horaDeCorte);
  if (!corte.ok) return err("HORA_DE_CORTE_INVALIDA");
  const formateador = formateadorDeZona(zonaHoraria);
  if (formateador === null) return err("ZONA_HORARIA_INVALIDA");
  const ms = instante.getTime();
  if (!(ms >= INSTANTE_MINIMO && ms <= INSTANTE_MAXIMO)) return err("INSTANTE_INVALIDO");

  const local = numerosPorTipo(formateador, instante);
  const minutosLocales = local.hour * 60 + local.minute;
  // Antes de la hora de corte todavía rige la jornada anterior: se resta un día civil.
  const retroceso = minutosLocales < minutosDelDia(corte.valor) ? 1 : 0;
  // `setUTCFullYear` (y no `Date.UTC`) para que los años 0 a 99 no se lean como 1900 a 1999.
  const fecha = new Date(0);
  fecha.setUTCFullYear(local.year, local.month - 1, local.day - retroceso);
  return ok(fecha.toISOString().slice(0, 10) as FechaCivil);
}
