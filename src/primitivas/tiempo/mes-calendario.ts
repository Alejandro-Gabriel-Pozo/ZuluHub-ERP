import type { Marca } from "../identificadores/marca";
import { err, ok, type Resultado } from "../resultado/resultado";
import { numeroDeDiaCivil } from "./dias";
import { fechaCivilDesdeTexto, type FechaCivil } from "./fecha-civil";

/**
 * Mes calendario `AAAA-MM`: un mes real del calendario gregoriano, con los días que tiene (28 a 31).
 * No hay forma de convertirlo en «30 días» ni de sumarle «un mes» como cantidad fija (D-5): un mes
 * entra siempre como `MesCalendario` o como rango de fechas. Valor puro.
 */
export type MesCalendario = Marca<string, "MesCalendario">;

export type ErrorDeMesCalendario = "MES_CALENDARIO_INVALIDO";

export function mesCalendarioDesdeTexto(
  texto: string,
): Resultado<MesCalendario, ErrorDeMesCalendario> {
  // `AAAA-MM-01` solo es una fecha civil válida si el texto es exactamente `AAAA-MM` con año y mes reales
  // (el validador exige el largo y el formato), y el día 01 existe en todo mes.
  return fechaCivilDesdeTexto(`${texto}-01`).ok
    ? ok(texto as MesCalendario)
    : err("MES_CALENDARIO_INVALIDO");
}

function anioYMes(mes: MesCalendario): { anio: number; mes: number } {
  return { anio: Number(mes.slice(0, 4)), mes: Number(mes.slice(5, 7)) };
}

export function primerDia(mes: MesCalendario): FechaCivil {
  return `${mes}-01` as FechaCivil;
}

/** Cantidad de días del mes (bisiestos incluidos), por diferencia entre el 1.º de este y del siguiente. */
export function diasDelMes(mes: MesCalendario): number {
  const { anio, mes: numero } = anioYMes(mes);
  // El «mes 13» de `numeroDeDiaCivil` cae en el 1.º de enero del año siguiente (diciembre se prueba).
  return numeroDeDiaCivil(anio, numero + 1, 1) - numeroDeDiaCivil(anio, numero, 1);
}

export function ultimoDia(mes: MesCalendario): FechaCivil {
  return `${mes}-${String(diasDelMes(mes)).padStart(2, "0")}` as FechaCivil;
}

function mesDe(anio: number, numero: number): Resultado<MesCalendario, ErrorDeMesCalendario> {
  return mesCalendarioDesdeTexto(
    `${String(anio).padStart(4, "0")}-${String(numero).padStart(2, "0")}`,
  );
}

/** Después de 9999-12 no hay mes: error explícito. */
export function mesSiguiente(mes: MesCalendario): Resultado<MesCalendario, ErrorDeMesCalendario> {
  const { anio, mes: numero } = anioYMes(mes);
  return numero === 12 ? mesDe(anio + 1, 1) : mesDe(anio, numero + 1);
}

/** Antes de 0001-01 no hay mes: error explícito. */
export function mesAnterior(mes: MesCalendario): Resultado<MesCalendario, ErrorDeMesCalendario> {
  const { anio, mes: numero } = anioYMes(mes);
  return numero === 1 ? mesDe(anio - 1, 12) : mesDe(anio, numero - 1);
}

/** ¿La fecha civil cae dentro del mes? */
export function contiene(mes: MesCalendario, fecha: FechaCivil): boolean {
  return fecha.slice(0, 7) === mes;
}
