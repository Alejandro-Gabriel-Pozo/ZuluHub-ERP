import { err, ok, type Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto } from "../texto/texto-de-una-linea";

/**
 * FICHA DEL DATO: DOMICILIO COMO TEXTO LIBRE (el del receptor de un comprobante). (DECIDIDO = ya implementado; SUPUESTO (DEC-0046) = del
 * ingeniero, revertible; SIN DECIDIR = falta la decisión del dueño.) NO es el domicilio estructurado de `domicilio.ts` (calle,
 * número, localidad, provincia…), que es el del emisor y de los puntos de venta.
 *
 * - Qué es: dónde queda el receptor, escrito a mano. Se imprime en la factura.
 * - Cómo se escribe: una sola línea; se recortan los blancos de los extremos, los espacios repetidos pasan a uno solo y queda en NFC.
 *   Entre 1 y `LARGO_MAXIMO_DEL_DOMICILIO_LIBRE` (300: el valor que ya tenía el sistema, sin fuente de ARCA; SUPUESTO (DEC-0046)) caracteres,
 *   contados por carácter. Solo los caracteres permitidos de `texto-de-una-linea.ts` (letras latinas, dígitos, espacio y una lista corta
 *   de signos; cotejada con el PDF y cubierta por la decisión del dueño de «una sola lista», 2026-11-05); lo demás se rechaza. No
 *   puede empezar con `+` ni `-` (Q7, DECIDIDO por el dueño, 2026-11-06: «Mantener», mensaje directo al orquestador). Puede ser todo números o llevar pocas letras («9 de Julio 1234»): la regla de
 *   «al menos una letra» NO le aplica (SUPUESTO (DEC-0046)).
 * - Obligatorio/opcional: lo decide quien la usa. Esta regla solo dice qué es un domicilio válido: vacío o en blanco = «no tiene» y es
 *   `null`; en la base es NULL, nunca un texto vacío. En un comprobante es OBLIGATORIO salvo con el consumidor final (DECIDIDO, dueño,
 *   2026-11-06, conversación directa con la sesión «Emitir», `Pedernal-docs/11-especificaciones/emitir-plan-factura-a.md` §1,
 *   decisión 3; norma: RG 1415, Anexo II, A.II, que pide el domicilio comercial de todo receptor que no sea consumidor final): esa
 *   exigencia vive en `modulos/fiscal/dominio/receptor.ts`, no acá.
 * - Único: no. Quién lo cambia: nadie, se congela en el comprobante (`receptor_domicilio`, 0009).
 * - Verificado o declarado: solo DECLARADO; no hay fuente oficial contra la que verificarlo.
 * - Qué ve el público: se imprime tal cual se guardó. «Emitir» lo pide en el paso del cliente, en una línea libre (dueño, 2026-11-06, decisión 4 del plan).
 * - Dato personal (qué se audita): SÍ puede serlo (el domicilio de una persona). La auditoría `COMPROBANTE_CREADO` registra clase,
 *   tipo, total, punto de venta, ambiente, origen y asociado, y NO incluye el domicilio (`emitir-comprobante.ts`); queda solo en el
 *   comprobante. Si alguna norma de datos personales lo alcanza: SIN DECIDIR.
 * - Cómo se compara y cómo se imprime: no se compara ni se busca por domicilio. Se imprime tal cual se guardó; el rótulo y el lugar
 *   en la hoja los fija el modelo de impresión (`modelo-de-impresion.ts`).
 * - Código de error: el motivo corto de `texto-de-una-linea.ts`; el receptor lo traduce a `RECEPTOR_INVALIDO` con `campo: "domicilio"`.
 *
 * Lo que repite la base: el CHECK `comprobante_receptor_domicilio_ck` (0009) pide 1 a 300 caracteres, sin blancos en los extremos y
 * sin control; esta regla es más estricta. Antes de esto el dominio no miraba el control y la base sí: un salto de línea llegaba a
 * la base y fallaba allá con un error genérico.
 */
export const LARGO_MAXIMO_DEL_DOMICILIO_LIBRE = 300;

export type ErrorDeDomicilioLibre = "DOMICILIO_INVALIDO";

/** `null` (ausente, vacío o solo blancos) pasa como `null`; un texto con contenido se valida y queda en su forma canónica. */
export function domicilioLibreDesdeTexto(
  texto: string | null,
): Resultado<string | null, ErrorDeDomicilioLibre> {
  if (texto === null || texto.trim() === "") return ok(null);
  const limpio = textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_DOMICILIO_LIBRE,
    exigirUnaLetra: false,
  });
  return limpio.ok ? limpio : err("DOMICILIO_INVALIDO");
}
