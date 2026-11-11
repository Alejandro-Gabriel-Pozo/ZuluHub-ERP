import type { Marca } from "../identificadores/marca";
import { err, ok, type Resultado } from "../resultado/resultado";

/**
 * FICHA DEL DATO: PAÍS (el de un documento extranjero o de un domicilio del exterior de una persona o empresa del directorio). (DECIDIDO =
 * ya implementado; SUPUESTO = del ingeniero, revertible, DEC-0080; SIN DECIDIR = falta la decisión del dueño.)
 *
 * - Qué es: el código de país de dos letras mayúsculas (ISO 3166-1 alfa-2: `AR`, `BR`, `UY`). Fuente: D126 de `catalogo-y-niveles-maqueta.md`
 *   («país y documento extranjero») y `directorio.html`.
 * - Cómo se escribe y qué se guarda: exactamente dos letras de la A a la Z, en mayúsculas; no se corrige ni se pasa a mayúsculas (la pantalla lo
 *   elige de una lista). SUPUESTO del ingeniero (DEC-0080): la forma y no la lista de los 249 códigos, porque ninguna decisión del dueño fija cuáles
 *   (costo de revertir: bajo, una lista cerrada en esta primitiva y un CHECK nuevo).
 * - Obligatorio/opcional: lo decide quien la usa (obligatorio con un documento extranjero). Único: no. Quién lo cambia: quien edita la parte.
 * - Dato personal: no por sí mismo. Se compara por igualdad exacta.
 * - Código de error: `PAIS_INVALIDO`. Ejemplos válidos: "AR", "BR". Inválidos: "ar", "ARG", "A", "A1", "Ñ", " AR".
 *
 * Lo que repite la base: `parte_documento_ck` y `parte_domicilio_ck` (0034) piden `^[A-Z]{2}$`; la prueba de la migración lo compara.
 */
export type CodigoDePais = Marca<string, "CodigoDePais">;

export type ErrorDePais = "PAIS_INVALIDO";

export const FORMATO_DE_PAIS = /^[A-Z]{2}$/;

export function paisDesdeTexto(texto: string): Resultado<CodigoDePais, ErrorDePais> {
  return FORMATO_DE_PAIS.test(texto) ? ok(texto as CodigoDePais) : err("PAIS_INVALIDO");
}
