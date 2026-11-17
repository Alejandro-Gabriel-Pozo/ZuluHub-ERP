import { err, ok, type Resultado } from "../resultado/resultado";
import { fechaCivilDesdeTexto, type ErrorDeFechaCivil, type FechaCivil } from "./fecha-civil";
import { fechaDeNegocio, type ErrorDeJornada } from "./fecha-de-negocio";

/**
 * FECHA CIVIL ENTRE 1900 Y HOY: la regla de las fechas que ya tienen que haber pasado (el inicio de actividades de una empresa).
 *
 * - Piso: `FECHA_CIVIL_MINIMA` = 1900-01-01. Q18, resuelta por el orquestador (decisión técnica, 2026-11-06; el dueño no objetó):
 *   nada anterior a 1900. La fecha civil base (`fecha-civil.ts`) acepta desde el año 0001: sirve para el calendario, no para un dato de negocio.
 * - Techo: «hoy» en Argentina, inclusive. Q17, respondida por el dueño el 2026-11-06 («Q17: ok»; el orquestador lo interpretó como
 *   aceptación de su recomendación): un inicio de actividades futuro se rechaza. Q20, resuelta por el orquestador el 2026-11-06:
 *   «hoy» es siempre el de Argentina (UTC-3), regla permanente del proyecto.
 * - El «hoy» sale del instante que se le pasa (el reloj del contexto): esta primitiva nunca lee el reloj. Si no se puede calcular el
 *   «hoy» (un instante inválido), la fecha se rechaza: sin techo no se acepta nada (todo nace cerrado).
 * - Una sola fuente: `ZONA_DE_ARGENTINA` y el cálculo del «hoy» viven acá; las pantallas y las consultas que hoy repiten la zona
 *   importan esta constante.
 *
 * Previene: un inicio de actividades futuro («2027-03-01») o absurdo («0001-01-01») guardado y después impreso en el comprobante;
 * caso real: `datos-fiscales.ts` solo miraba que fuera una fecha del calendario. Chequeo: `fecha-civil-hasta-hoy.test.ts`
 * (los bordes: 1899-12-31, 1900-01-01, ayer, hoy, mañana, y el cambio de día de Argentina frente a UTC).
 */
export const ZONA_DE_ARGENTINA = "America/Argentina/Buenos_Aires";

export const FECHA_CIVIL_MINIMA = "1900-01-01" as FechaCivil;

export type ErrorDeFechaCivilHastaHoy = ErrorDeFechaCivil | "FECHA_FUERA_DE_RANGO";

/** El día civil de Argentina en `ahora` (corte 00:00, como el resto del sistema). */
export function hoyEnArgentina(ahora: Date): Resultado<FechaCivil, ErrorDeJornada> {
  return fechaDeNegocio(ahora, ZONA_DE_ARGENTINA, "00:00");
}

/** La fecha real `YYYY-MM-DD`, no anterior a 1900-01-01 ni posterior al «hoy» de Argentina en `ahora`. */
export function fechaCivilHastaHoyDesdeTexto(
  texto: string,
  ahora: Date,
): Resultado<FechaCivil, ErrorDeFechaCivilHastaHoy> {
  const fecha = fechaCivilDesdeTexto(texto);
  if (!fecha.ok) return fecha;
  const hoy = hoyEnArgentina(ahora);
  if (!hoy.ok) return err("FECHA_FUERA_DE_RANGO");
  // Las fechas son `YYYY-MM-DD` de ancho fijo: el orden del texto es el orden del calendario.
  if (fecha.valor < FECHA_CIVIL_MINIMA || fecha.valor > hoy.valor)
    return err("FECHA_FUERA_DE_RANGO");
  return ok(fecha.valor);
}
