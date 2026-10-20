import {
  LIMITES_DE_INACTIVIDAD,
  estadoDeInactividad,
  type LimitesDeInactividad,
} from "../experiencia/inactividad";

/**
 * Cuánto dura una sesión de la aplicación y cuándo se la da por buena (web-armazon §4.3 G4 y G5, §4.5).
 * Funciones puras: el reloj entra como dato, así que se prueban y se mutan sin esperar. La base guarda
 * fechas y la librería de ingreso hace su parte (renueva `expiresAt` en cada uso); lo que NO hace la
 * librería, y se decide acá, es el tope absoluto de 8 horas y el atado al host.
 *
 * Decisión del dueño: sin uso, la sesión del mostrador vence a los 15 minutos (los límites de
 * `estadoDeInactividad`: una sola fuente para el servidor y para el aviso de la pantalla); con uso, a las
 * 8 horas de creada como máximo.
 */

const MINUTO_EN_MS = 60_000;
const HORA_EN_MS = 3_600_000;

export type LimitesDeSesion = Readonly<{
  inactividad: LimitesDeInactividad;
  /** Cuánto puede durar una sesión desde que se creó, aunque se la use sin parar. */
  absolutoEnMs: number;
}>;

export const LIMITES_DE_SESION: LimitesDeSesion = Object.freeze({
  inactividad: LIMITES_DE_INACTIVIDAD,
  absolutoEnMs: 8 * HORA_EN_MS,
});

/**
 * Los límites de la consola de plataforma (h5-p8 §1; DECIDIDO por el dueño): 8 horas absolutas y 30 minutos de
 * inactividad, con el aviso a los 25 (quedan 5). Los de empresa (`LIMITES_DE_SESION`) no cambian.
 */
export const LIMITES_DE_SESION_DE_PLATAFORMA: LimitesDeSesion = Object.freeze({
  inactividad: Object.freeze({ avisoEnMs: 25 * MINUTO_EN_MS, vencimientoEnMs: 30 * MINUTO_EN_MS }),
  absolutoEnMs: 8 * HORA_EN_MS,
});

/**
 * Los límites con que el barrido da una sesión por vencida. Las dos audiencias (empresa y consola) comparten la tabla
 * `session`: si el barrido usara los 15 minutos de inactividad de la web, borraría las sesiones de la consola (30
 * minutos) a medio uso. Se toma el PLAZO MÁS LARGO de cada límite: lo que sobra de una audiencia lo corta su propio
 * `expiresAt` (el primer criterio del barrido, exacto para cada sesión), así que el barrido sigue limpiando y nunca
 * borra una sesión que todavía vale.
 */
export function limitesDelBarrido(...audiencias: readonly LimitesDeSesion[]): LimitesDeSesion {
  const mayor = (valores: readonly number[]) => Math.max(...valores);
  return Object.freeze({
    inactividad: Object.freeze({
      avisoEnMs: mayor(audiencias.map((l) => l.inactividad.avisoEnMs)),
      vencimientoEnMs: mayor(audiencias.map((l) => l.inactividad.vencimientoEnMs)),
    }),
    absolutoEnMs: mayor(audiencias.map((l) => l.absolutoEnMs)),
  });
}

export const LIMITES_DEL_BARRIDO: LimitesDeSesion = limitesDelBarrido(
  LIMITES_DE_SESION,
  LIMITES_DE_SESION_DE_PLATAFORMA,
);

/** Lo que la librería de ingreso pide como `expiresIn`: segundos de inactividad hasta el vencimiento. */
export function segundosDeInactividad(limites: LimitesDeSesion = LIMITES_DE_SESION): number {
  return limites.inactividad.vencimientoEnMs / 1000;
}

/**
 * El nuevo vencimiento de una sesión que se acaba de usar: `ahora` más la inactividad tolerada, pero
 * nunca más allá del tope absoluto contado desde que se creó (G5). Previene la sesión eterna por
 * actividad. Una fecha inválida da una fecha ya vencida (falla cerrado).
 */
export function vencimientoRenovado(
  creadaEn: Date,
  ahora: Date,
  limites: LimitesDeSesion = LIMITES_DE_SESION,
): Date {
  const porInactividad = ahora.getTime() + limites.inactividad.vencimientoEnMs;
  const porTope = creadaEn.getTime() + limites.absolutoEnMs;
  const vence = Math.min(porInactividad, porTope);
  return Number.isNaN(vence) ? new Date(0) : new Date(vence);
}

/** Lo de una sesión que decide si vale: sus fechas y el host en el que nació. */
export type DatosDeSesion = Readonly<{
  host: string;
  creadaEn: Date;
  ultimoUso: Date;
  venceEn: Date;
}>;

/**
 * - `OTRO_HOST`: la sesión nació en un host distinto del del pedido (o alguno de los dos no se sabe):
 *   una cookie copiada de la marca A no vale en la B (G4). Se decide ANTES que el vencimiento y quien
 *   llama no la renueva ni la toca.
 * - `VENCIDA`: pasó el vencimiento guardado, el tope de 8 horas o la inactividad.
 * - `VIGENTE`: ninguna de las anteriores.
 */
export type VigenciaDeSesion = "VIGENTE" | "VENCIDA" | "OTRO_HOST";

export function vigenciaDeSesion(
  sesion: DatosDeSesion,
  hostDelPedido: string,
  ahora: Date,
  limites: LimitesDeSesion = LIMITES_DE_SESION,
): VigenciaDeSesion {
  if (hostDelPedido === "" || sesion.host !== hostDelPedido) return "OTRO_HOST";
  const instante = ahora.getTime();
  // Comparaciones escritas para que una fecha inválida (NaN) caiga en VENCIDA y no en VIGENTE.
  const sigueEnPie =
    sesion.venceEn.getTime() > instante &&
    sesion.creadaEn.getTime() + limites.absolutoEnMs > instante;
  if (!sigueEnPie) return "VENCIDA";
  return estadoDeInactividad(sesion.ultimoUso, ahora, limites.inactividad) === "VENCIDA"
    ? "VENCIDA"
    : "VIGENTE";
}
