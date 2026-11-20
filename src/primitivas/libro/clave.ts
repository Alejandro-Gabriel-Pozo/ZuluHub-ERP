import { err, ok, type Resultado } from "../resultado/resultado";

/**
 * La forma de la clave de idempotencia de los libros nuevos: 16 a 128 caracteres de `A-Z a-z 0-9 _ -`. Es la de caja
 * (`migraciones/0027_caja.sql`) y la de compras (`pago_clave_ck`, `0037`); la base la copia en un CHECK y una prueba de
 * conformidad (LB-2) la compara.
 */
export const FORMA_DE_CLAVE = /^[A-Za-z0-9_-]{16,128}$/;

export type ErrorDeClave = "CLAVE_INVALIDA";

export function exigirClave(texto: string): Resultado<string, ErrorDeClave> {
  return FORMA_DE_CLAVE.test(texto) ? ok(texto) : err("CLAVE_INVALIDA");
}
