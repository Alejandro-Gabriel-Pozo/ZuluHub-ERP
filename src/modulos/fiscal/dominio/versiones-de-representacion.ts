/**
 * Las versiones de representación del modelo de impresión y desde cuál lleva cada bloque (aparte de `modelo-de-impresion.ts`, que
 * está en el tope de 400 líneas). Una regla, un lugar: quien arma el modelo pregunta acá.
 */

/**
 * Las versiones que este código sabe dibujar; cualquier otra se rechaza (`VERSION_DE_REPRESENTACION_DESCONOCIDA`):
 * lista cerrada, no «todo lo menor o igual a la actual», para que subir la versión sea una decisión explícita.
 * - 1: el formato anterior a los textos legales de la RG 5614/2024. Se conserva SIN CAMBIOS: lo sellado con 1
 *   reimprime idéntico (golden `modelo-factura-b-marca-*` y `modelo-nota-de-credito-a-produccion`). No incluía la
 *   leyenda «A CONSUMIDOR FINAL» aunque la norma la pedía antes; no se corrige por diseño.
 * - 2: suma la leyenda del receptor consumidor final, la de crédito fiscal de la A a monotributista, el bloque de transparencia fiscal de la B, el contacto congelado
 *   de la sucursal (D-98) y el modo de precio.
 * - 3: suma la leyenda de la condición del receptor frente al IVA (RG 1415 Anexo II A.II a.4, e.4, f.4). La 2 no la lleva y
 *   reimprime idéntica.
 * Previene que reimprimir un AUTORIZADO muestre textos que su original no tenía. Sin migración: la columna es
 * `smallint` con `CHECK (>= 1)` (0009) y `emitir-comprobante` sella `VERSION_DE_REPRESENTACION_ACTUAL`. Chequeo:
 * los golden de la 1, la 2 y la 3 y la prueba de versiones desconocidas de `modelo-de-impresion.test.ts`.
 */
export const VERSIONES_SOPORTADAS: readonly number[] = [1, 2, 3];

/** La que sellan los comprobantes nuevos. */
export const VERSION_DE_REPRESENTACION_ACTUAL = 3;

/** Primera versión que lleva los textos legales de la norma; las anteriores no los llevan. */
export const PRIMERA_VERSION_CON_TEXTOS_LEGALES = 2;

/**
 * Primera versión que lleva el contacto de la sucursal (D-98). Aparte de los textos legales: el contacto no es un texto de la
 * norma y una versión futura puede cambiar uno sin tocar el otro. La 1 no lo lleva y reimprime idéntica.
 */
export const PRIMERA_VERSION_CON_CONTACTO = 2;

/** Primera versión que lleva el nombre de la sucursal (D-114). Constante propia, por la misma razón que el contacto. La 1 no lo lleva. */
export const PRIMERA_VERSION_CON_SUCURSAL = 2;

/**
 * Primera versión que expone el modo de precio, para que la vista elija el encabezado de la columna de precio. Aparte de las
 * otras dos por la misma razón que el contacto: una versión futura puede cambiar una sin tocar las demás. La 1 no lo lleva.
 */
export const PRIMERA_VERSION_CON_MODO_DE_PRECIO = 2;

/**
 * Primera versión que lleva la leyenda de la condición del receptor (RG 1415 Anexo II A.II). Constante propia por la misma razón que el
 * contacto. Qué versión se usa al emitir: siempre `VERSION_DE_REPRESENTACION_ACTUAL`, que es la mayor de `VERSIONES_SOPORTADAS`
 * (`versiones-de-representacion.test.ts` lo exige); un comprobante emitido conserva la que selló.
 */
export const PRIMERA_VERSION_CON_LEYENDA_DE_CONDICION = 3;
