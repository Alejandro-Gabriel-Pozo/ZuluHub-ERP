/**
 * LA FORMA DE UN IMPORTE QUE ESCRIBE QUIEN VENDE O COBRA (E4 §3.2): dígitos y hasta 2 decimales con punto, sin signo, de hasta 9 enteros (la cota de
 * la base, 999.999.999,99). La usan el precio abierto y el importe de cada cobro: una sola regla. En la pantalla se escribe con coma
 * (decisión 153) y el servidor recibe esta forma canónica. Cualquier otra cosa es `IMPORTE_INVALIDO`.
 */
// fuente-unica: ajeno — coincide con un largo de 9 de otra primitiva; son los enteros máximos de un importe (cota 1.000.000.000 de la base), dato sin relación
export const FORMA_DEL_IMPORTE = /^[0-9]{1,9}(\.[0-9]{1,2})?$/;
