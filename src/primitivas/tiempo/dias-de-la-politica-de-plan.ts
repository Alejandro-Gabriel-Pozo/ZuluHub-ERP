/**
 * Los tres números de la política de cambio de plan (anticipación de una suba, anticipación de una baja y plazo de arrepentimiento) son
 * días enteros de 0 a `MAXIMO_DE_DIAS_DE_LA_POLITICA_DE_PLAN` (H-14a; tope: SUPUESTO (DEC-0777) de la sesión, un año). Una sola fuente: el dominio, el caso
 * de uso y la consola la importan; la base solo copia el valor (`BETWEEN 0 AND 365` de la migración 0087) y una prueba de integración falla si difieren.
 * Previene: el tope escrito a mano en el servidor y en la base que se desfasa (el servidor acepta una política que la base rechaza a mitad de la
 * transacción). Chequeo: `test/integracion/politica-de-cambio-migracion.test.ts`.
 */
export const MAXIMO_DE_DIAS_DE_LA_POLITICA_DE_PLAN = 365;

/** ¿Es un número entero de días dentro del tope de la política? `Number.isInteger` rechaza todo lo que no sea un entero, también lo que llegue sin tipar. */
export function esDiasDeLaPoliticaDePlan(valor: number): boolean {
  return Number.isInteger(valor) && valor >= 0 && valor <= MAXIMO_DE_DIAS_DE_LA_POLITICA_DE_PLAN;
}
