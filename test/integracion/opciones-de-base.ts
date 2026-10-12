/**
 * Cómo se crea toda base descartable de las pruebas: UTF8 con locale `C`, a propósito.
 *  - UTF8 es la codificación de producción (Neon); un servidor local armado con SQL_ASCII daría
 *    resultados que producción no da (por ejemplo, `char_length` contaría bytes y el orden ICU de
 *    0005 no existiría).
 *  - Locale `C` es el peor caso para `lower()` y los órdenes de texto: `lower('CAFÉ')` no es
 *    `café`. Si una regla de la base dependiera del locale del servidor, las pruebas lo mostrarían
 *    en cualquier máquina, tenga el locale que tenga.
 * `TEMPLATE template0` es lo que permite elegir codificación y locale distintos de los del servidor.
 */
export const OPCIONES_DE_BASE = "TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'";
