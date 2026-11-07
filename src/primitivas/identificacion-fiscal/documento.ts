import { err, ok, type Resultado } from "../resultado/resultado";
import { cuitDesdeTexto } from "./cuit";
import { tieneNumeroInformableAArca } from "./numero-de-documento-para-arca";
import { pasaporteDesdeTexto } from "./pasaporte";

/**
 * FICHA DEL DATO: DOCUMENTO DE IDENTIDAD (el del receptor de un comprobante). (DECIDIDO = ya implementado; SUPUESTO = del ingeniero,
 * revertible; SIN DECIDIR = falta la decisión del dueño.) El CUIT, CUIL y CDI son el mismo número (`cuit.ts`); acá vive la regla
 * de cada tipo, que antes estaba dentro del módulo fiscal y la web no podía reutilizar.
 *
 * - Qué es: el número con el que se identifica una persona o empresa: CUIT, CUIL, CDI, DNI o pasaporte. Códigos de ARCA (fuente:
 *   `test/utilidades/arca-grabaciones/corrida1/012-FEParamGetTiposDoc-respuesta-http200.xml`): CUIT 80, CUIL 86, CDI 87, DNI 96,
 *   Pasaporte 94 (los códigos viven en `fiscal/dominio/codigos-de-arca.ts`).
 * - Cómo se escribe y qué se guarda: CUIT, CUIL y CDI: 11 dígitos con dígito verificador; se acepta también con guiones
 *   `XX-XXXXXXXX-X` y se guarda sin ellos (DECIDIDO, `cuit.ts`). DNI: de 6 a 9 dígitos, sin cero a la izquierda (DECIDIDO en el código;
 *   sin fuente de ARCA); al escribirlo se aceptan los puntos de miles (`12.345.678`) y se guarda sin ellos (DECIDIDO, dueño, 2026-11-06,
 *   Q6: guiones en CUIT/CUIL/CDI, puntos en DNI, cualquier otro carácter se rechaza). PASAPORTE: se guarda TAL CUAL figura, letras y
 *   números de 6 a 9 caracteres (`ABC123456`; DECIDIDO, dueño, 2026-11-06, Q5), y se rechaza si no tiene una cifra distinta de cero para
 *   informar a ARCA: son dos datos con ficha propia, `pasaporte.ts` (la figura) y `numero-de-documento-para-arca.ts` (lo que se manda).
 *   NO VERIFICADO que ARCA acepte el tipo 94 con esa parte numérica (se prueba en homologación). Salvo el pasaporte, la forma
 *   canónica son solo dígitos.
 * - Cómo se muestra: con guiones (CUIT/CUIL/CDI) y con puntos (DNI). El CUIT con guiones lo arma una sola función
 *   (`cuit.ts`: `cuitParaMostrar`), que importan la web y la consola; los puntos del DNI siguen en la web (`formato-fiscal.ts`) y
 *   pasarlos acá es otro paso.
 * - Obligatorio/opcional: lo decide quien la usa. Con el consumidor final sin identificar no hay documento (tipo `SIN_IDENTIFICAR`).
 * - Único: el del receptor no. Quién lo cambia: nadie, se congela en el comprobante.
 * - Verificado o declarado: de CUIT/CUIL/CDI se verifica el dígito verificador; el resto es solo DECLARADO. Compatible con
 *   verificar contra ARCA por CUIT; esa consulta NO está construida.
 * - Dato personal (qué se audita): SÍ puede serlo (el DNI, CUIL o CDI de una persona). La auditoría `COMPROBANTE_CREADO` NO guarda el
 *   documento (`emitir-comprobante.ts`: «sin nombre ni documento del receptor»); queda solo en el comprobante. Si alguna norma de
 *   datos personales lo alcanza: SIN DECIDIR.
 * - Cómo se compara: por igualdad exacta de la forma canónica (solo dígitos, o el pasaporte en mayúsculas); por eso «30-71234567-1» y «30712345671» son el mismo.
 *   La búsqueda del listado de comprobantes por documento es por prefijo (`lecturas-de-comprobantes.ts`).
 * - Código de error: `DOCUMENTO_INVALIDO`; el receptor lo traduce a `RECEPTOR_INVALIDO` con `campo: "documento"`.
 * - Ejemplos válidos: CUIT "30-71234567-1" (queda "30712345671"), DNI "12345678", pasaporte "ABC123456". Inválidos: un nombre en el
 *   campo del documento, CUIT con dígito verificador mal, DNI "012345678".
 *
 * Lo que repite la base: `comprobante_receptor_documento_ck` (0009, ampliada en 0024) pide solo dígitos (1 a 11) y, para CUIT/CUIL/CDI,
 * `cuit_valido`; desde 0024 un PASAPORTE puede ser además `^[A-Z0-9]{6,9}$` con una cifra del 1 al 9. La base NO valida el DNI por tipo ni
 * limita el pasaporte de solo dígitos a 6 a 9 (compatibilidad con lo ya guardado): esa regla, más estricta, vive acá.
 */
export const TIPOS_DE_DOCUMENTO_DE_IDENTIDAD = ["CUIT", "CUIL", "CDI", "DNI", "PASAPORTE"] as const;

export type TipoDeDocumentoDeIdentidad = (typeof TIPOS_DE_DOCUMENTO_DE_IDENTIDAD)[number];

export type ErrorDeDocumento = "DOCUMENTO_INVALIDO";

/** DNI: sin ceros a la izquierda, de 6 a 9 dígitos. */
export const FORMATO_DE_DNI = /^[1-9][0-9]{5,8}$/;
/**
 * DNI escrito con puntos de miles: un primer grupo de 1 a 3 dígitos y uno o dos grupos de 3 (`1.234.567`, `12.345.678`).
 * Es la lista de lo PERMITIDO (P1): cualquier otro uso del punto o cualquier espacio no entra. Después se exige la forma canónica.
 */
export const FORMATO_DE_DNI_CON_PUNTOS = /^[1-9][0-9]{0,2}(\.[0-9]{3}){1,2}$/;
/** El número en su forma canónica (solo dígitos) si corresponde al tipo, o `DOCUMENTO_INVALIDO`. */
export function numeroDeDocumentoDesdeTexto(
  tipo: TipoDeDocumentoDeIdentidad,
  texto: string,
): Resultado<string, ErrorDeDocumento> {
  switch (tipo) {
    case "CUIT":
    case "CUIL":
    case "CDI": {
      const cuit = cuitDesdeTexto(texto);
      return cuit.ok ? ok(cuit.valor) : err("DOCUMENTO_INVALIDO");
    }
    case "DNI": {
      const canonico = FORMATO_DE_DNI_CON_PUNTOS.test(texto) ? texto.replaceAll(".", "") : texto;
      return FORMATO_DE_DNI.test(canonico) ? ok(canonico) : err("DOCUMENTO_INVALIDO");
    }
    case "PASAPORTE": {
      // Dos datos distintos (`pasaporte.ts` y `numero-de-documento-para-arca.ts`): la figura que se guarda, y que tenga una cifra
      // distinta de cero que informar a ARCA (sin ella `DocNro` valdría 0, «sin identificar»).
      const pasaporte = pasaporteDesdeTexto(texto);
      return pasaporte.ok && tieneNumeroInformableAArca(pasaporte.valor)
        ? ok(pasaporte.valor)
        : err("DOCUMENTO_INVALIDO");
    }
  }
}
