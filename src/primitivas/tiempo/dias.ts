import { err, ok, type Resultado } from "../resultado/resultado";
import { fechaCivilDesdeTexto, type FechaCivil } from "./fecha-civil";

/**
 * Días entre fechas civiles. Aritmética entera sobre el calendario gregoriano (días desde
 * 1970-01-01): no usa `Date`, así que el resultado no depende de la zona horaria del servidor.
 * Valores puros: sin reloj, sin azar y sin I/O.
 */
export type ErrorDeDias = "FECHA_CIVIL_INVALIDA" | "CANTIDAD_DE_DIAS_INVALIDA";

/** 1 = lunes … 7 = domingo (ISO 8601). */
export type DiaDeLaSemana = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Días desde 1970-01-01 de un día civil (algoritmo de Hinnant); el mes entra de 1 a 12. */
export function numeroDeDiaCivil(anio: number, mes: number, dia: number): number {
  const a = mes <= 2 ? anio - 1 : anio;
  const era = Math.floor(a / 400);
  const anioDeLaEra = a - era * 400;
  const diaDelAnio = Math.floor((153 * (mes > 2 ? mes - 3 : mes + 9) + 2) / 5) + dia - 1;
  const diaDeLaEra =
    anioDeLaEra * 365 + Math.floor(anioDeLaEra / 4) - Math.floor(anioDeLaEra / 100) + diaDelAnio;
  return era * 146097 + diaDeLaEra - 719468;
}

/** Año, mes y día de una fecha civil ya validada. */
export function partesDeFecha(fecha: FechaCivil): { anio: number; mes: number; dia: number } {
  return {
    anio: Number(fecha.slice(0, 4)),
    mes: Number(fecha.slice(5, 7)),
    dia: Number(fecha.slice(8, 10)),
  };
}

export function numeroDeDia(fecha: FechaCivil): number {
  const { anio, mes, dia } = partesDeFecha(fecha);
  return numeroDeDiaCivil(anio, mes, dia);
}

/** Texto `AAAA-MM-DD` del día número `numero`; el llamador garantiza que cae entre los años 1 y 9999. */
export function fechaDeNumeroDeDia(numero: number): FechaCivil {
  const z = numero + 719468;
  const era = Math.floor(z / 146097);
  const diaDeLaEra = z - era * 146097;
  const anioDeLaEra = Math.floor(
    (diaDeLaEra -
      Math.floor(diaDeLaEra / 1460) +
      Math.floor(diaDeLaEra / 36524) -
      Math.floor(diaDeLaEra / 146096)) /
      365,
  );
  const diaDelAnio =
    diaDeLaEra - (365 * anioDeLaEra + Math.floor(anioDeLaEra / 4) - Math.floor(anioDeLaEra / 100));
  const mesDelCalendario = Math.floor((5 * diaDelAnio + 2) / 153);
  const dia = diaDelAnio - Math.floor((153 * mesDelCalendario + 2) / 5) + 1;
  const mes = mesDelCalendario < 10 ? mesDelCalendario + 3 : mesDelCalendario - 9;
  const anio = anioDeLaEra + era * 400 + (mes <= 2 ? 1 : 0);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${String(anio).padStart(4, "0")}-${dos(mes)}-${dos(dia)}` as FechaCivil;
}

/** Días de `desde` a `hasta` (negativo si `hasta` es anterior). */
export function diasEntre(desde: FechaCivil, hasta: FechaCivil): number {
  return numeroDeDia(hasta) - numeroDeDia(desde);
}

/** Suma (o resta, si es negativo) días enteros; fuera del año 0001 a 9999 es error. */
export function sumarDias(fecha: FechaCivil, dias: number): Resultado<FechaCivil, ErrorDeDias> {
  if (!Number.isSafeInteger(dias)) return err("CANTIDAD_DE_DIAS_INVALIDA");
  const destino = numeroDeDia(fecha) + dias;
  // Fuera de 0001-01-01 … 9999-12-31 el texto no es una fecha civil: lo rechaza el validador.
  const validada = fechaCivilDesdeTexto(fechaDeNumeroDeDia(destino));
  return validada.ok ? ok(validada.valor) : err("FECHA_CIVIL_INVALIDA");
}

export function diaDeLaSemana(fecha: FechaCivil): DiaDeLaSemana {
  // 1970-01-01 fue jueves (4).
  return (((((numeroDeDia(fecha) + 3) % 7) + 7) % 7) + 1) as DiaDeLaSemana;
}
