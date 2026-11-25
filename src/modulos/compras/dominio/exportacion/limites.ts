/**
 * Los límites de la exportación de compras a Excel (dueño, 25/11/2026; una regla, un lugar): hasta 20.000 filas de detalle o 12 meses por pedido, lo que ocurra
 * primero. Por encima NO se corta en silencio ni se arma a medias: se rechaza el pedido entero. Previene: una petición web que arma un archivo sin tope (memoria y
 * tiempo de la función) y un archivo parcial que parece completo. Chequeo: `exportacion-limites.test.ts`.
 */
export const FILAS_MAXIMAS_DE_LA_EXPORTACION = 20_000;
export const MESES_MAXIMOS_DE_LA_EXPORTACION = 12;
/** Cuántas compras se leen por vuelta dentro de la misma transacción (las consultas por lote no crecen con el período). */
export const TAMANO_DE_TANDA_DE_LA_EXPORTACION = 500;

const FORMA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * ¿`hasta` cae antes del mismo día un año después de `desde`? Con `desde` = 01/07/2026 el último `hasta` válido es el 30/06/2027 (12 meses justos). Compara textos
 * `AAAA-MM-DD` ya validados como fechas civiles por quien llama (la comparación de texto ordena igual que el calendario); sin reloj.
 */
export function periodoDeLaExportacionValido(desde: string, hasta: string): boolean {
  const d = FORMA.exec(desde);
  if (d === null || FORMA.exec(hasta) === null || desde > hasta) return false;
  const limite = `${Number(d[1]) + MESES_MAXIMOS_DE_LA_EXPORTACION / 12}-${d[2]}-${d[3]}`;
  return hasta < limite;
}
