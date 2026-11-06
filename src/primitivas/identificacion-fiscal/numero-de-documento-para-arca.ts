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
 * - Qué se rechaza al escribir un pasaporte nuevo (DECIDIDO, orquestador, 2026-11-06, P2; fail-closed): ninguna cifra («ABCDEF») o
 *   todas en cero («ABC000000»: ARCA usa `DocNro` 0 para «sin identificar»). Esto lo decide `tieneNumeroInformableAArca`; el cálculo
 *   en sí es total para lo ya guardado (un pasaporte viejo «0» sigue dando 0 y se puede reimprimir).
 * - NO VERIFICADO contra ARCA: que acepte `DocTipo` 94 con este número (se prueba en homologación antes de darlo por bueno).
 * - Lo que repite la base: `comprobante_receptor_documento_ck` (0024) exige, en un pasaporte con letras, al menos una cifra del 1 al 9
 *   (`[1-9]`); `test/integracion/pasaporte-migracion.test.ts` lo compara con esta regla.
 */

const NO_DIGITOS = /[^0-9]/g;

/** Las cifras del documento, en orden, o `null` si no tiene ninguna. */
function cifrasDe(numero: string): string | null {
  const cifras = numero.replace(NO_DIGITOS, "");
  return cifras === "" ? null : cifras;
}

/** ¿Hay una cifra distinta de cero? Con solo ceros, `DocNro` valdría 0 y ARCA lo lee como «sin identificar». */
export function tieneNumeroInformableAArca(numero: string): boolean {
  return /[1-9]/.test(numero);
}

/**
 * El `DocNro` del documento, sin pasar por `number`. Lanza si el documento no tiene ninguna cifra: la base lo impide, y un
 * documento así no debe llegar a ARCA.
 */
export function numeroDeDocumentoInformadoAArca(numero: string): bigint {
  const cifras = cifrasDe(numero);
  if (cifras === null)
    throw new RangeError("el documento no tiene ninguna cifra que informar a ARCA");
  return BigInt(cifras);
}
