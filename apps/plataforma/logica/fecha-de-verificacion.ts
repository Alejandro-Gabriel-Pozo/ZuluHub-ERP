/**
 * La fecha que la consola le pasa a «Verificar» un dominio: el INICIO del día en la Argentina (UTC-3, sin horario de verano) en que se pide. Es un día entero a
 * propósito: el caso de uso exige la MISMA fecha al repetir un pedido con la misma clave, y con el instante exacto un clic doble (o un reintento tras un corte de red)
 * la cambiaría y se rechazaría como «clave reutilizada». Nunca es futura. Puro: el reloj llega por parámetro.
 * Es provisoria: cuando la verificación consulte el DNS (T2 del plan de dominio propio), la fecha la toma el servidor y este archivo se retira.
 */
const MS_POR_DIA = 24 * 60 * 60 * 1000;
const DESFASE_ARGENTINA_EN_MS = 3 * 60 * 60 * 1000;

export function inicioDelDiaArgentino(ahora: Date): Date {
  const local = ahora.getTime() - DESFASE_ARGENTINA_EN_MS;
  const inicioLocal = Math.floor(local / MS_POR_DIA) * MS_POR_DIA;
  return new Date(inicioLocal + DESFASE_ARGENTINA_EN_MS);
}
