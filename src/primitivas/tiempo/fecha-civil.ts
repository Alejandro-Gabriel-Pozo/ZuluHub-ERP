import type { Marca } from "../identificadores/marca";
import { err, ok, type Resultado } from "../resultado/resultado";

/**
 * Fecha civil `YYYY-MM-DD`: un día del calendario gregoriano sin hora ni zona (la del `date` de
 * Postgres). Es texto en la frontera, con marca para que un texto cualquiera no pase por fecha.
 * Valor puro: sin reloj, sin azar y sin I/O.
 */
export type FechaCivil = Marca<string, "FechaCivil">;

export type ErrorDeFechaCivil = "FECHA_CIVIL_INVALIDA";

const FORMATO = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

function esBisiesto(anio: number): boolean {
  return anio % 4 === 0 && (anio % 100 !== 0 || anio % 400 === 0);
}

/** Valida una fecha real del calendario gregoriano (año 0001 en adelante), sin normalizar nada. */
export function fechaCivilDesdeTexto(texto: string): Resultado<FechaCivil, ErrorDeFechaCivil> {
  const partes = FORMATO.exec(texto);
  if (partes === null) return err("FECHA_CIVIL_INVALIDA");
  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])] as const;
  if (anio < 1 || dia < 1) return err("FECHA_CIVIL_INVALIDA");
  const diasDelMes = [31, esBisiesto(anio) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // Un mes fuera de 1 a 12 no tiene entrada en la tabla: 0 días, así que ningún día entra.
  if (dia > (diasDelMes[mes - 1] ?? 0)) return err("FECHA_CIVIL_INVALIDA");
  return ok(texto as FechaCivil);
}
