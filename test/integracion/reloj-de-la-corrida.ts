import type { FechaCivil } from "../../src/primitivas/tiempo/fecha-civil";
import { hoyEnArgentina } from "../../src/primitivas/tiempo/fecha-civil-hasta-hoy";

/**
 * EL RELOJ DE LAS PRUEBAS (una sola fuente de «ahora» y de «hoy» para pruebas, fixtures y apoyos): el «ahora» de los contextos de las pruebas de integración que
 * abren y cierran jornadas (caja, cierre del día) y el «hoy» de negocio de Argentina. Con `new Date()` en cada llamada, una prueba
 * que abría una sesión y la cerraba o consultaba después caía en OTRA fecha de negocio si el reloj cruzaba la medianoche de Buenos Aires (03:00 UTC) entre
 * una llamada y la otra (caso real: «desactivar contra abrir una sesión con la jornada ya creada», gate del 15/11/2026). Este reloj avanza como el real,
 * pero si el archivo arranca en los últimos 20 minutos del día se corre una hora hacia atrás, de modo que no cruza la medianoche mientras corre el archivo.
 *
 * FIJABLE: con `PEDERNAL_RELOJ_FIJO` (un instante con su desfase, p. ej. `2026-11-16T23:30:00-03:00`) el reloj ARRANCA en ese instante y avanza como el real
 * (la corrida chica del CI de reloj lo usa para correr la suite crítica a las 23:30 y 00:30 de Argentina y al cambio de día UTC). Un valor que no tiene esa forma
 * hace fallar la carga (denegar por defecto): nunca se ignora en silencio. Lo que NO mueve: el `now()` de la base ni el reloj de los procesos aparte; por eso
 * una prueba que mezcle ese reloj con este falla cuando el reloj está fijado lejos del real, que es justo lo que se quiere ver.
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

/** La variable que fija el instante de arranque del reloj (ver arriba). */
export const VARIABLE_DEL_RELOJ_FIJO = "PEDERNAL_RELOJ_FIJO";
/** Lo único que se acepta: fecha, hora y desfase explícitos (`Z` o `±HH:MM`). Sin desfase el instante dependería de la zona de la máquina. */
const FORMA_DEL_INSTANTE_FIJO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/** El instante de arranque que pide la variable (milisegundos), o `null` si no se pidió ninguno. Un valor mal formado o imposible lanza. */
export function instanteFijado(valor: string | undefined): number | null {
  if (valor === undefined || valor === "") return null;
  const instante = FORMA_DEL_INSTANTE_FIJO.test(valor) ? Date.parse(valor) : Number.NaN;
  if (!Number.isFinite(instante)) {
    throw new Error(
      `${VARIABLE_DEL_RELOJ_FIJO} tiene que ser un instante con su desfase, p. ej. 2026-11-16T23:30:00-03:00.`,
    );
  }
  return instante;
}

/** Cuánto se atrasa el reloj respecto del real, decidido UNA vez al cargar: lo que lleve a `fijo` si se pidió uno, o el corrimiento que evita cruzar la medianoche. */
export function desplazamientoDeLaCorrida(inicio: number, fijo: number | null): number {
  return fijo === null ? desplazamientoParaNoCruzarLaMedianoche(inicio) : inicio - fijo;
}

const DESPLAZAMIENTO = desplazamientoDeLaCorrida(
  Date.now(),
  instanteFijado(process.env[VARIABLE_DEL_RELOJ_FIJO]),
);

/** «Ahora» para armar un contexto: avanza como el reloj real y no cruza la medianoche de Buenos Aires durante la corrida del archivo. */
export const ahoraDeLaCorrida = (): Date => new Date(Date.now() - DESPLAZAMIENTO);

/** El «hoy» de negocio de Argentina (corte 00:00) según este reloj: la fecha que NO sale de `current_date` ni de `now()` de la base. */
export function hoyDeNegocio(): FechaCivil {
  const hoy = hoyEnArgentina(ahoraDeLaCorrida());
  if (!hoy.ok) throw new Error(`El reloj de la corrida no da un «hoy» válido (${hoy.error}).`);
  return hoy.valor;
}
