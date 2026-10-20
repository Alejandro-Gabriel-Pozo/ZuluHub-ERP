/**
 * Las ventanas de tiempo del segundo factor de la consola de plataforma (h5-p8 §2.4 y §2.4 bis). Funciones puras: el
 * reloj entra como dato, así que se prueban y se mutan sin esperar y dan lo mismo en el servidor que en la pantalla.
 *
 *  - «Reciente» (G3): ver el secreto, emitir códigos nuevos y dar de baja el TOTP exigen que el segundo factor se haya
 *    verificado hace 5 minutos o menos EN ESA SESIÓN (DECIDIDO por el dueño). Previene: que una sesión que solo pasó
 *    por Google (o cuyo segundo factor es viejo) pueda leer el secreto o cambiar los códigos.
 *  - Enrolar: un administrador sin TOTP solo puede dar de alta el suyo durante los primeros 10 minutos de la
 *    sesión (ASUMIDO). Previene: que una sesión robada y vieja registre su propio segundo factor.
 *
 * Falla cerrado: una fecha inválida no está «dentro» de ninguna ventana, y una fecha en el futuro más lejos que la
 * tolerancia del reloj tampoco (un valor corrupto no puede valer para siempre). La tolerancia cubre la diferencia
 * de reloj entre dos instancias del servidor: la verificación que escribió una instancia la lee otra.
 */

const MINUTO_EN_MS = 60_000;

export const VENTANA_DEL_SEGUNDO_FACTOR_RECIENTE_EN_MS = 5 * MINUTO_EN_MS;
export const VENTANA_DE_ENROLAMIENTO_EN_MS = 10 * MINUTO_EN_MS;
export const TOLERANCIA_DE_RELOJ_EN_MS = MINUTO_EN_MS;

function dentroDeLaVentana(desde: Date | null, ahora: Date, ventanaEnMs: number): boolean {
  if (desde === null) return false;
  const edad = ahora.getTime() - desde.getTime();
  // Con una fecha inválida `edad` es NaN y las dos comparaciones dan falso.
  return edad >= -TOLERANCIA_DE_RELOJ_EN_MS && edad <= ventanaEnMs;
}

/** ¿El segundo factor de la sesión se verificó hace 5 minutos o menos? `null`: nunca se verificó. */
export function segundoFactorReciente(segundoFactorEn: Date | null, ahora: Date): boolean {
  return dentroDeLaVentana(segundoFactorEn, ahora, VENTANA_DEL_SEGUNDO_FACTOR_RECIENTE_EN_MS);
}

/** Cuántos milisegundos le quedan a la ventana de «reciente», o 0 si ya no vale (o nunca valió). */
export function segundoFactorRecienteHastaMs(segundoFactorEn: Date | null, ahora: Date): number {
  if (!segundoFactorReciente(segundoFactorEn, ahora)) return 0;
  // `segundoFactorReciente` ya descartó el `null` (nunca verificado). Una verificación «en el futuro» (diferencia de
  // reloj) cuenta como recién hecha: no se prolonga la ventana.
  const edad = Math.max(0, ahora.getTime() - (segundoFactorEn as Date).getTime());
  return VENTANA_DEL_SEGUNDO_FACTOR_RECIENTE_EN_MS - edad;
}

/** ¿La sesión nació hace 10 minutos o menos? Solo entonces se puede enrolar el segundo factor. */
export function puedeEnrolar(sesionCreadaEn: Date, ahora: Date): boolean {
  return dentroDeLaVentana(sesionCreadaEn, ahora, VENTANA_DE_ENROLAMIENTO_EN_MS);
}
