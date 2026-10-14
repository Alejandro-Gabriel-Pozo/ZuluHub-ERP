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
