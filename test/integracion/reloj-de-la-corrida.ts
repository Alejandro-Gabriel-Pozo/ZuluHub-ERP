/**
 * El «ahora» de los contextos de las pruebas de integración que abren y cierran jornadas (caja, cierre del día). Con `new Date()` en cada llamada, una prueba
 * que abría una sesión y la cerraba o consultaba después caía en OTRA fecha de negocio si el reloj cruzaba la medianoche de Buenos Aires (03:00 UTC) entre
 * una llamada y la otra (caso real: «desactivar contra abrir una sesión con la jornada ya creada», gate del 15/11/2026). Este reloj avanza como el real,
 * pero si el archivo arranca en los últimos 20 minutos del día se corre una hora hacia atrás, de modo que no cruza la medianoche mientras corre el archivo.
 */
const UNA_HORA = 3_600_000;
const DIA = 24 * UNA_HORA;
const MARGEN_DE_LA_MEDIANOCHE = 20 * 60_000;

/** Milisegundos transcurridos del día de Buenos Aires (UTC-3, sin horario de verano) en un instante. */
const msDelDiaLocal = (instante: number): number => (((instante - 3 * UNA_HORA) % DIA) + DIA) % DIA;

/** Cuánto se atrasa este reloj, decidido UNA vez al cargar el archivo. */
export function desplazamientoParaNoCruzarLaMedianoche(inicio: number): number {
  return msDelDiaLocal(inicio) > DIA - MARGEN_DE_LA_MEDIANOCHE ? UNA_HORA : 0;
}

const DESPLAZAMIENTO = desplazamientoParaNoCruzarLaMedianoche(Date.now());

/** «Ahora» para armar un contexto: avanza como el reloj real y no cruza la medianoche de Buenos Aires durante la corrida del archivo. */
export const ahoraDeLaCorrida = (): Date => new Date(Date.now() - DESPLAZAMIENTO);
