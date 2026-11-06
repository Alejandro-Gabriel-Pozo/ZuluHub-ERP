import { err, ok, type Resultado } from "../resultado/resultado";
import { cuitDesdeTexto } from "./cuit";

/**
 * FICHA DEL DATO: DOCUMENTO DE IDENTIDAD (el del receptor de un comprobante). (DECIDIDO = ya implementado; SUPUESTO = del ingeniero,
 * revertible; SIN DECIDIR = falta la decisión del dueño.) El CUIT, CUIL y CDI son el mismo número (`cuit.ts`); acá vive la regla
 * de cada tipo, que antes estaba dentro del módulo fiscal y la web no podía reutilizar.
 *
 * - Qué es: el número con el que se identifica una persona o empresa: CUIT, CUIL, CDI, DNI o pasaporte. Códigos de ARCA (fuente:
 *   `test/utilidades/arca-grabaciones/corrida1/012-FEParamGetTiposDoc-respuesta-http200.xml`): CUIT 80, CUIL 86, CDI 87, DNI 96,
 *   Pasaporte 94 (los códigos viven en `fiscal/dominio/codigos-de-arca.ts`).
 * - Cómo se escribe y qué se guarda: SOLO DÍGITOS (la forma canónica), sin guiones ni puntos. CUIT, CUIL y CDI: 11 dígitos con
 *   dígito verificador; se acepta también con guiones `XX-XXXXXXXX-X` y se guarda sin ellos (DECIDIDO, `cuit.ts`). DNI: de 6 a 9
 *   dígitos, sin cero a la izquierda (DECIDIDO en el código; sin fuente de ARCA). Pasaporte: de 1 a 11 dígitos, porque `DocNro` es
 *   un `Long (11)` en WSFE v4.8 (l. 577); NO VERIFICADO que ARCA acepte el tipo 94 con ese formato, ni que no haya pasaportes con
 *   letras (SIN DECIDIR, Q5). Con puntos o espacios el DNI y el pasaporte se rechazan (SIN DECIDIR si se aceptan al escribir, Q6).
 * - Cómo se muestra: con guiones (CUIT/CUIL/CDI) y con puntos (DNI). Hoy lo hace la web por su cuenta (`formato-fiscal.ts`) y la
 *   consola otra vez (`formato-de-cuit.ts`); unificarlo es otro paso, NO este.
 * - Obligatorio/opcional: lo decide quien la usa. Con el consumidor final sin identificar no hay documento (tipo `SIN_IDENTIFICAR`).
 * - Único: el del receptor no. Quién lo cambia: nadie, se congela en el comprobante.
 * - Verificado o declarado: de CUIT/CUIL/CDI se verifica el dígito verificador; el resto es solo DECLARADO. Compatible con
 *   verificar contra ARCA por CUIT; esa consulta NO está construida.
 * - Dato personal (qué se audita): SÍ puede serlo (el DNI, CUIL o CDI de una persona). La auditoría `COMPROBANTE_CREADO` NO guarda el
 *   documento (`emitir-comprobante.ts`: «sin nombre ni documento del receptor»); queda solo en el comprobante. Si alguna norma de
 *   datos personales lo alcanza: SIN DECIDIR.
 * - Cómo se compara: por igualdad exacta de la forma canónica (solo dígitos); por eso «30-71234567-1» y «30712345671» son el mismo.
 *   La búsqueda del listado de comprobantes por documento es por prefijo (`lecturas-de-comprobantes.ts`).
 * - Código de error: `DOCUMENTO_INVALIDO`; el receptor lo traduce a `RECEPTOR_INVALIDO` con `campo: "documento"`.
 * - Ejemplos válidos: CUIT "30-71234567-1" (queda "30712345671"), DNI "12345678", pasaporte "123456". Inválidos: un nombre en el
 *   campo del documento, CUIT con dígito verificador mal, DNI "012345678".
 *
 * Lo que repite la base: `comprobante_receptor_documento_ck` (0009) pide solo dígitos (1 a 11) y, para CUIT/CUIL/CDI, `cuit_valido`.
 * La base NO valida DNI ni pasaporte por tipo: esa regla vive solo acá.
 */
export const TIPOS_DE_DOCUMENTO_DE_IDENTIDAD = ["CUIT", "CUIL", "CDI", "DNI", "PASAPORTE"] as const;

export type TipoDeDocumentoDeIdentidad = (typeof TIPOS_DE_DOCUMENTO_DE_IDENTIDAD)[number];

export type ErrorDeDocumento = "DOCUMENTO_INVALIDO";

/** DNI: sin ceros a la izquierda, de 6 a 9 dígitos. */
export const FORMATO_DE_DNI = /^[1-9][0-9]{5,8}$/;
/** Pasaporte: de 1 a 11 dígitos (`DocNro` es un `Long (11)` en WSFE v4.8). */
export const FORMATO_DE_PASAPORTE = /^[0-9]{1,11}$/;

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
    case "DNI":
      return FORMATO_DE_DNI.test(texto) ? ok(texto) : err("DOCUMENTO_INVALIDO");
    case "PASAPORTE":
      return FORMATO_DE_PASAPORTE.test(texto) ? ok(texto) : err("DOCUMENTO_INVALIDO");
  }
}
