/**
 * FICHA DEL DATO: NÚMERO DE DOCUMENTO QUE SE INFORMA A ARCA (`DocNro`). Es un dato DISTINTO del documento tal cual figura: el
 * comprobante guarda y muestra el documento completo; a ARCA se le manda solo su parte numérica. Es la ÚNICA función que lo calcula:
 * el pedido a ARCA, la reconciliación con lo que ARCA devuelve y el QR pasan todos por `numeroDeDocumentoParaArca` (dominio fiscal),
 * que la usa. (DECIDIDO = ya implementado; SUPUESTO = del ingeniero, revertible; SIN DECIDIR = falta la decisión del dueño.)
 *
 * - Qué es: el entero que ARCA recibe en `DocNro`, un `Long (11)` (fuente: manual WSFE v4.8 línea 577,
 *   `12-referencias-externas/arca-manuales-del-dueno/WSFE_manual_RG-4291_v4-8.md` del repositorio de documentación; el manual NO
 *   dice nada del formato del pasaporte). DECIDIDO (dueño, 2026-11-06, Q5): se informa SOLO la parte numérica.
 * - Cómo se calcula: se juntan los dígitos del documento, en orden, y se leen como número. `ABC123456` → 123456; `AAB000123` → 123
 *   (los ceros a la izquierda se pierden: es un entero; el comprobante conserva el documento completo); `A1B2C3D4` → 1234 (cualquier
 *   mezcla vale, consecuencia de «letras y números, de 6 a 9» sin forma fija). Un documento de solo dígitos (CUIT, CUIL, CDI, DNI y los
 *   pasaportes numéricos de antes) da EXACTAMENTE el mismo número que antes: es la identidad.
 * - Qué se rechaza (DECIDIDO, orquestador, 2026-11-06, P2 y revisión del 2026-11-07; fail-closed): ninguna cifra («ABCDEF») o todas en
 *   cero («ABC000000»: ARCA usa `DocNro` 0 para «sin identificar»). Lo decide `tieneNumeroInformableAArca`, al escribir el pasaporte y
 *   también acá, que lanza. Solo para el tipo PASAPORTE; los demás tipos no extraen cifras de un texto (ver `receptor.ts`).
 * - Imprimir NO valida (dueño, 2026-11-07): la hoja y el QR de un comprobante emitido usan `numeroDeDocumentoGuardado` (nunca
 *   lanza). Solo lo que se ENVÍA a ARCA es estricto.
 * - NO VERIFICADO contra ARCA: que acepte `DocTipo` 94 con este número (se prueba en homologación antes de darlo por bueno).
 * - Lo que repite la base: `comprobante_receptor_documento_ck` (0024) exige, en un pasaporte con letras, al menos una cifra del 1 al 9
 *   (`[1-9]`); `test/integracion/pasaporte-migracion.test.ts` lo compara con esta regla.
 */

const NO_DIGITOS = /[^0-9]/g;

/** ¿Hay una cifra distinta de cero? Con solo ceros, `DocNro` valdría 0 y ARCA lo lee como «sin identificar». */
export function tieneNumeroInformableAArca(numero: string): boolean {
  return /[1-9]/.test(numero);
}

/**
 * LECTURA de un documento ya guardado (hoja y QR de un comprobante YA emitido): sus cifras en orden, sin pasar por `number`, y
 * NUNCA lanza. Un comprobante emitido está congelado e imprimir no valida ni pide nada a ARCA (dueño, 2026-11-07): sin cifras o todo en
 * cero da 0, lo mismo que se envió en su momento. Para un documento de solo dígitos es `BigInt(numero)`. El rigor está en
 * `numeroDeDocumentoInformadoAArca`, que arma lo que se ENVÍA.
 */
export function numeroDeDocumentoGuardado(numero: string): bigint {
  // El «0» de adelante hace que «sin cifras» sea 0 y no una excepción de `BigInt("")`; no cambia ningún otro número.
  return BigInt(`0${numero.replace(NO_DIGITOS, "")}`);
}

/**
 * El `DocNro` de un PASAPORTE que se va a ENVIAR a ARCA. Lanza si no hay una cifra distinta de cero: con ninguna cifra no hay número que
 * informar y con todas en cero `DocNro` valdría 0 («sin identificar» para ARCA); la base y la validación de entrada lo impiden, y esto
 * es la última capa antes de ARCA (fail closed). SOLO se usa con el tipo PASAPORTE: los demás documentos se leen enteros
 * (`numeroDeDocumentoParaArca`, dominio fiscal), nunca extrayendo cifras de un texto que no es un número.
 */
export function numeroDeDocumentoInformadoAArca(numero: string): bigint {
  const guardado = numeroDeDocumentoGuardado(numero);
  if (guardado === 0n)
    throw new RangeError("el documento no tiene ninguna cifra que informar a ARCA");
  return guardado;
}
