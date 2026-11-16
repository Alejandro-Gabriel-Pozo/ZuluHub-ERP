/**
 * La forma de un uuid escrito como texto: UN lugar (CLAUDE.md «Una regla, un lugar»). Dos formas con nombre propio, porque
 * piden cosas distintas y no se pueden mezclar sin cambiar qué se acepta:
 *
 *  - `esUuidCualquiera`: 8-4-4-4-12 dígitos hexadecimales, sin mirar versión ni variante. Es lo que acepta la base (`uuid`) y
 *    lo que usan los filtros, el plan y la protección de las acciones del servidor de la consola.
 *  - `esUuidEstandar`: además versión 1 a 8 y variante RFC 4122 (`89ab`). Es lo que exigen las entradas del alta de empresa y de
 *    la submarca: los ids que genera el sistema (v4 o v7) siempre la cumplen.
 *
 * Mayúsculas o minúsculas (la base compara el valor, no el texto). Previene: seis copias de la expresión en la consola de
 * plataforma, dos de ellas con una forma más estricta que las otras sin que nada lo dijera; `test/arquitectura/forma-de-uuid.test.ts`
 * falla si reaparece una copia.
 */
const CUALQUIERA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ESTANDAR = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const esUuidCualquiera = (valor: unknown): valor is string =>
  typeof valor === "string" && CUALQUIERA.test(valor);

export const esUuidEstandar = (valor: unknown): valor is string =>
  typeof valor === "string" && ESTANDAR.test(valor);
