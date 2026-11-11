import type { Marca } from "../identificadores/marca";
import { err, ok, type Resultado } from "../resultado/resultado";

/**
 * FICHA DEL DATO: DOCUMENTO EXTRANJERO (el número de identificación de una persona o empresa del exterior: un RUT, un NIF, un RUC). (DECIDIDO =
 * ya implementado; SUPUESTO = del ingeniero, revertible; SIN DECIDIR = falta la decisión del dueño.)
 *
 * - Qué es: el identificador que un país extranjero le da a una persona o empresa. Va siempre con su país (`pais.ts`). Fuente: D126 de
 *   `catalogo-y-niveles-maqueta.md` («una empresa solo admite CUIT o documento extranjero») y `directorio.html`.
 * - Cómo se escribe y qué se guarda: solo letras de la A a la Z y dígitos, de 3 a 20 caracteres; las minúsculas se guardan en mayúsculas
 *   (como el pasaporte). SUPUESTO del ingeniero: el rango 3 a 20 es el del DDL verificado de `clientes.md` (Anexo C); ninguna decisión del dueño
 *   lo fija y los formatos de cada país son otros (guiones, puntos): costo de revertir bajo, una primitiva y un CHECK.
 * - Qué NO se acepta (lista de permitidos): espacios, guiones, puntos, tildes ni ningún otro carácter.
 * - Obligatorio/opcional: lo decide quien la usa. Único: sí, por empresa y país (lo impone la base, `parte_documento_uk`). Quién lo cambia: quien edita la parte.
 * - Dato personal: SÍ puede serlo (el documento de una persona). La auditoría de la parte NO guarda el valor (F2 de `clientes-y-proveedores.md`).
 * - Código de error: `DOCUMENTO_EXTRANJERO_INVALIDO`. Ejemplos válidos: "RUT12345678", "abc" (queda "ABC"). Inválidos: "AB" (2), 21 caracteres,
 *   "12-345", "RUT 123".
 *
 * Lo que repite la base: `parte_documento_ck` (0034) pide `^[A-Z0-9]{3,20}$` para `ID_EXTRANJERO`; la prueba de la migración lo compara.
 */
export type DocumentoExtranjero = Marca<string, "DocumentoExtranjero">;

export type ErrorDeDocumentoExtranjero = "DOCUMENTO_EXTRANJERO_INVALIDO";

// Privadas a propósito: un `LARGO_MAXIMO_` exportado de una primitiva hace que el chequeo de fuente única cuente cualquier 20 de otro archivo (un corte de UUID) como copia.
const LARGO_MINIMO_DE_DOCUMENTO_EXTRANJERO = 3;
const LARGO_MAXIMO_DE_DOCUMENTO_EXTRANJERO = 20;

export const FORMATO_DE_DOCUMENTO_EXTRANJERO = new RegExp(
  `^[A-Z0-9]{${LARGO_MINIMO_DE_DOCUMENTO_EXTRANJERO},${LARGO_MAXIMO_DE_DOCUMENTO_EXTRANJERO}}$`,
);

/** Solo las letras ASCII a-z (`toUpperCase` también transforma otros caracteres, como `ß`). */
function conMayusculas(texto: string): string {
  return texto.replace(/[a-z]/g, (letra) => letra.toUpperCase());
}

export function documentoExtranjeroDesdeTexto(
  texto: string,
): Resultado<DocumentoExtranjero, ErrorDeDocumentoExtranjero> {
  const figura = conMayusculas(texto);
  return FORMATO_DE_DOCUMENTO_EXTRANJERO.test(figura)
    ? ok(figura as DocumentoExtranjero)
    : err("DOCUMENTO_EXTRANJERO_INVALIDO");
}
