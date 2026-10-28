/**
 * Fechas de vigencia de la consola, en hora argentina (UTC-3 fijo, sin horario de verano). Puro: el reloj
 * llega por parámetro.
 */

const DESFASE_EN_HORAS = 3;
const UN_DIA_EN_MS = 24 * 60 * 60 * 1000;

const dosDigitos = (n: number): string => String(n).padStart(2, "0");

/** 'AAAA-MM-DD' de MAÑANA en hora argentina: la vigencia retroactiva la rechaza el backend. */
export function fechaMinimaDeVigencia(ahora: Date): string {
  const manana = new Date(ahora.getTime() - DESFASE_EN_HORAS * 3_600_000 + UN_DIA_EN_MS);
  return `${String(manana.getUTCFullYear())}-${dosDigitos(manana.getUTCMonth() + 1)}-${dosDigitos(manana.getUTCDate())}`;
}

function partesDeFecha(fecha: string): { a: number; m: number; d: number } | null {
  const coincide = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (coincide === null) return null;
  const a = Number(coincide[1]);
  const m = Number(coincide[2]);
  const d = Number(coincide[3]);
  if (a < 2000 || a > 2100) return null;
  const prueba = new Date(Date.UTC(a, m - 1, d));
  if (
    prueba.getUTCFullYear() !== a ||
    prueba.getUTCMonth() !== m - 1 ||
    prueba.getUTCDate() !== d
  ) {
    return null;
  }
  return { a, m, d };
}

/** La medianoche argentina de esa fecha como instante; `null` si no es una fecha de calendario real. */
export function instanteDeVigencia(fecha: string): Date | null {
  const partes = partesDeFecha(fecha);
  return partes === null
    ? null
    : new Date(Date.UTC(partes.a, partes.m - 1, partes.d, DESFASE_EN_HORAS));
}

/** 'DD/MM/AAAA', o el texto tal cual si no es una fecha válida. */
export function fechaLegible(fecha: string): string {
  const partes = partesDeFecha(fecha);
  return partes === null
    ? fecha
    : `${dosDigitos(partes.d)}/${dosDigitos(partes.m)}/${String(partes.a)}`;
}
