const ESPERA_BASE_EN_MS = 40;
const ESPERA_TOPE_EN_MS = 1000;

/**
 * Cuánto esperar antes del reintento número `intento` (0 es el primero): espera exponencial con «jitter completo»
 * (un valor al azar entre 0 y el techo del intento). Bajo SERIALIZABLE los chequeos de existencia toman bloqueos de
 * lectura gruesos, así que varias transacciones simultáneas se cancelan entre sí al confirmar (40001); una espera
 * fija y corta las hace chocar otra vez en bloque y agota los reintentos. El techo crece con cada intento y se corta
 * en `ESPERA_TOPE_EN_MS`.
 */
export function esperaDelReintento(intento: number, azar: () => number = Math.random): number {
  return azar() * Math.min(ESPERA_TOPE_EN_MS, ESPERA_BASE_EN_MS * 2 ** intento);
}
