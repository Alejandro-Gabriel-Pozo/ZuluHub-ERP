/**
 * `numeroDeCorreccion` (decisión 177; E4 §3.8): el original es el ejemplar 1 y `ejemplar_vigente` sube de a uno con cada corrección o
 * anulación, así que la cantidad de correcciones es `ejemplar_vigente − 1` (0 = no corregido). Lo calcula el SERVIDOR y lo devuelve toda
 * salida que identifica un ticket: la pantalla no lo deduce de otra cosa. Un `ejemplar_vigente` menor que 1 no existe (la base lo rechaza)
 * y es un dato roto: se frena, no se corrige en silencio. Puro.
 */
export function numeroDeCorreccion(ejemplarVigente: number): number {
  if (!Number.isInteger(ejemplarVigente) || ejemplarVigente < 1) {
    throw new RangeError("el ejemplar vigente de un ticket es un entero mayor o igual que 1");
  }
  return ejemplarVigente - 1;
}
