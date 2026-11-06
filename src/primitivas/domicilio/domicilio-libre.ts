import { err, ok, type Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto } from "../texto/texto-de-una-linea";

/**
 * FICHA DEL DATO: DOMICILIO COMO TEXTO LIBRE (el del receptor de un comprobante). (DECIDIDO = ya implementado; SUPUESTO = del
 * ingeniero, revertible; SIN DECIDIR = falta la decisión del dueño.) NO es el domicilio estructurado de `domicilio.ts` (calle,
 * número, localidad, provincia…), que es el del emisor y de los puntos de venta.
 *
 * - Qué es: dónde queda el receptor, escrito a mano. Se imprime en la factura.
 * - Cómo se escribe: una sola línea; se recortan los blancos de los extremos, los espacios repetidos pasan a uno solo y queda en NFC.
 *   Entre 1 y `LARGO_MAXIMO_DEL_DOMICILIO_LIBRE` (300: el valor que ya tenía el sistema, sin fuente de ARCA; SUPUESTO) caracteres,
 *   contados por carácter. Solo los caracteres permitidos de `texto-de-una-linea.ts` (SUPUESTO, Q25: letras latinas, dígitos, espacio
 *   y una lista corta de signos); lo demás se rechaza. Puede ser todo números o llevar pocas letras («9 de Julio 1234»): la regla de
 *   «al menos una letra» NO le aplica (SUPUESTO).
 * - Obligatorio/opcional: hoy OPCIONAL y así lo trata este código (era el comportamiento que ya había). Vacío o en blanco = «no
 *   tiene» y es `null`; en la base es NULL, nunca un texto vacío. PENDIENTE, SIN DECIDIR (Q24): la norma (RG 1415, Anexo II, A.II,
 *   según el orquestador, 2026-11-05; el texto de la norma NO se pudo leer desde esta rama) pediría el domicilio de todo receptor
 *   que no sea consumidor final; no se aplica en este cambio porque la pantalla de Emitir todavía no tiene el campo.
 * - Único: no. Quién lo cambia: nadie, se congela en el comprobante (`receptor_domicilio`, 0009).
 * - Verificado o declarado: solo DECLARADO; no hay fuente oficial contra la que verificarlo.
 * - Qué ve el público: se imprime tal cual se guardó. Hoy la pantalla de Emitir no tiene este campo y manda `null`.
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
