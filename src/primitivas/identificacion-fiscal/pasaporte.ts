import type { Marca } from "../identificadores/marca";
import { err, ok, type Resultado } from "../resultado/resultado";

/**
 * FICHA DEL DATO: PASAPORTE COMO FIGURA (el número tal cual está impreso en el pasaporte del receptor). (DECIDIDO = ya implementado;
 * SUPUESTO = del ingeniero, revertible; SIN DECIDIR = falta la decisión del dueño.) Es un dato DISTINTO del «número que se informa a
 * ARCA» (`numero-de-documento-para-arca.ts`): este es lo que se guarda y se imprime; aquel, lo que se manda.
 *
 * - Qué es: el número de un pasaporte, como figura en el documento (el argentino son 3 letras y 6 números: `ABC123456`).
 * - Cómo se escribe y qué se guarda: SOLO letras de la A a la Z (mayúsculas) y dígitos, de 6 a 9 caracteres, en cualquier
 *   mezcla (DECIDIDO, dueño, 2026-11-06, Q5: «letras y números, de 6 a 9 caracteres»; sin forma fija, así que `A1B2C3D4` también
 *   vale). Se guarda TAL CUAL y así sale en el comprobante. Las minúsculas se pasan a mayúsculas al escribirlas (SUPUESTO, orquestador
 *   2026-11-06: costo de revertir bajo, es una línea de esta primitiva y la base sigue aceptando solo mayúsculas).
 * - Qué NO se acepta (lista de permitidos, nunca de prohibidos): espacios, guiones, puntos, tildes, la Ñ ni ningún otro carácter.
 * - Por qué 6 a 9: estándar internacional de pasaportes (decisión del dueño). Los pasaportes ya guardados, solo de dígitos y de 1 a 11
 *   (lo que aceptaba la base antes), siguen siendo válidos para la BASE; esta regla rige para las emisiones nuevas (orquestador, P5).
 * - Obligatorio/opcional: lo decide quien la usa. Único: no. Quién lo cambia: nadie, se congela en el comprobante.
 * - Dato personal (qué se audita): SÍ puede serlo. La auditoría `COMPROBANTE_CREADO` no guarda el documento (ver `documento.ts`).
 * - Cómo se compara: por igualdad exacta del texto guardado (mayúsculas).
 * - Lo que repite la base: `comprobante_receptor_documento_ck` (0024) pide, para el tipo PASAPORTE, `^[A-Z0-9]{6,9}$`; la prueba
 *   `test/integracion/pasaporte-migracion.test.ts` falla si la base y estas constantes difieren.
 * - Ejemplos válidos: "ABC123456", "abc123456" (se guarda "ABC123456"), "A1B2C3D4", "123456". Inválidos: "ABC12" (5), "ABC1234567"
 *   (10), "ABC-123456", "ÑAB123456", " ABC123456".
 */
export type Pasaporte = Marca<string, "Pasaporte">;

export type ErrorDePasaporte = "PASAPORTE_INVALIDO";

export const LARGO_MINIMO_DE_PASAPORTE = 6;
export const LARGO_MAXIMO_DE_PASAPORTE = 9;
/** El conjunto permitido (una sola vez): letras mayúsculas de la A a la Z y dígitos. */
export const CARACTERES_PERMITIDOS_DE_PASAPORTE = "A-Z0-9";

export const FORMATO_DE_PASAPORTE = new RegExp(
  `^[${CARACTERES_PERMITIDOS_DE_PASAPORTE}]{${LARGO_MINIMO_DE_PASAPORTE},${LARGO_MAXIMO_DE_PASAPORTE}}$`,
);

/** Solo las letras ASCII a-z: `toUpperCase` de JS también transforma otros caracteres (`ß` → `SS`) y eso no es lo que se permite. */
function conMayusculas(texto: string): string {
  return texto.replace(/[a-z]/g, (letra) => letra.toUpperCase());
}

export function pasaporteDesdeTexto(texto: string): Resultado<Pasaporte, ErrorDePasaporte> {
  const figura = conMayusculas(texto);
  return FORMATO_DE_PASAPORTE.test(figura) ? ok(figura as Pasaporte) : err("PASAPORTE_INVALIDO");
}
