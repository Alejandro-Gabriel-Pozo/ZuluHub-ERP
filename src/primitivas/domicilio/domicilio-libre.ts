import { err, ok, type Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto } from "../texto/texto-de-una-linea";

/**
 * FICHA DEL DATO: DOMICILIO COMO TEXTO LIBRE (el del receptor de un comprobante). (DECIDIDO = ya implementado; SUPUESTO = del
 * ingeniero, revertible; SIN DECIDIR = falta la decisión del dueño.) NO es el domicilio estructurado de `domicilio.ts` (calle,
 * número, localidad, provincia…), que es el del emisor y de los puntos de venta.
 *
 * - Qué es: dónde queda el receptor, escrito a mano. Se imprime en la factura.
 * - Cómo se escribe: una sola línea; se recortan los blancos de los extremos, los espacios repetidos pasan a uno solo y queda en NFC.
 *   Entre 1 y `LARGO_MAXIMO_DEL_DOMICILIO_LIBRE` (300, DECIDIDO: el valor que ya tenía el sistema) caracteres, contados por
 *   carácter. Sin caracteres de control, de formato invisible ni bidi, `<` `>` ni emojis (ver `texto-de-una-linea.ts`). Puede ser
 *   todo números o llevar pocas letras («9 de Julio 1234»): la regla de «al menos una letra» NO le aplica (SUPUESTO).
 * - Obligatorio/opcional: OPCIONAL (DECIDIDO). Vacío o en blanco = «no tiene» y es `null`; en la base es NULL, nunca un texto vacío.
 * - Único: no. Quién lo cambia: nadie, se congela en el comprobante (`receptor_domicilio`, 0009).
 * - Verificado o declarado: solo DECLARADO; no hay fuente oficial contra la que verificarlo.
 * - Qué ve el público: se imprime tal cual se guardó. Hoy la pantalla de Emitir no tiene este campo y manda `null`.
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
  const limpio = textoDeUnaLineaDesdeTexto(texto, LARGO_MAXIMO_DEL_DOMICILIO_LIBRE);
  return limpio.ok ? limpio : err("DOMICILIO_INVALIDO");
}
