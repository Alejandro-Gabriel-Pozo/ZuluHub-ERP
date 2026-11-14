/**
 * LÍMITES DE DIVIDIR LA CUENTA (dueño, 14/11/2026, `11-especificaciones/decisiones-del-dueno-2026-11.md` del repo de docs: antes 4 y 6, salidos de
 * maquetas): como máximo 10 cuentas al dividir por ÍTEMS y 12 partes al dividir por PORCENTAJE (o en partes iguales). Sin tabla ni perilla.
 * Una sola fuente: el dominio, la pantalla y las pruebas las importan; la base solo copia el valor (`division_partes_ck` y
 * `parte_de_division_numero_ck` admiten hasta `MAXIMO_DE_PARTES_EN_LA_BASE`, migración 0052) y una prueba de integración falla si difieren.
 * Previene: el tope escrito a mano en dominio, pantalla y base que se desfasa (cuando el servidor acepta 10 y la base rechaza la cuenta 5 a mitad
 * de una transacción). Chequeo: `test/arquitectura/fuente-unica-limites-de-division.test.ts` (número escrito a mano o constante repetida) y
 * `test/integracion/salon-division-limites.test.ts` (la base coincide).
 */
export const MAXIMO_DE_CUENTAS_POR_ITEMS = 10;
export const MAXIMO_DE_PARTES_POR_PORCENTAJE = 12;

/** Lo que admite la base: el mayor de los dos límites (cada caso de uso exige el suyo, más chico o igual). */
export const MAXIMO_DE_PARTES_EN_LA_BASE = Math.max(
  MAXIMO_DE_CUENTAS_POR_ITEMS,
  MAXIMO_DE_PARTES_POR_PORCENTAJE,
);
