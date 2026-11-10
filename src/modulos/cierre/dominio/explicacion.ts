import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * FICHA DEL DATO: EXPLICACIÓN DEL CIERRE (decisión 160: «el texto es opcional»; e3b §3.2: `observacion` y `texto` de 500).
 *
 * - Qué es: lo que escribe quien cierra el día para explicar un hallazgo que reconoce (una por control) y, aparte, una observación
 *   general de la jornada. Opcional siempre. Se guarda inmutable con la jornada cerrada.
 * - Cómo se escribe: una línea de 1 a `LARGO_MAXIMO_DE_LA_EXPLICACION` caracteres hecha SOLO de la lista de abajo (letras latinas con
 *   tilde y ñ, dígitos, espacio y los signos de una frase en castellano). Los extremos se recortan, el texto pasa a NFC y los
 *   espacios repetidos quedan en uno; vacío o solo blancos = sin explicación (`null`). Lo que no está en la lista se rechaza
 *   (saltos de línea y tabuladores adentro, invisibles, `<` y `>`, emojis): lista de permitidos, no de prohibidos.
 * - Código de error: `EXPLICACION_INVALIDA`.
 *
 * SUPUESTO (ingeniero, sin fuente del dueño): el conjunto de signos y el tope de 500 (el tope sale de la especificación e3b §3.2). La
 * lista de `texto-de-una-linea.ts` es la de nombres y direcciones: no admite `¿ ¡ ? ! %`, que una explicación en castellano necesita.
 * Costo de revertir: cambiar las constantes de abajo y el CHECK de la base (`jornada_observacion_ck`, `control_texto_ck`).
 * Se extraerá a `primitivas/` cuando caja (motivo de una corrección, explicación de una diferencia) la necesite (ADR-014).
 */
export const LARGO_MAXIMO_DE_LA_EXPLICACION = 500;

export type ErrorDeExplicacion = "EXPLICACION_INVALIDA";

const LETRAS = "A-Za-zÀ-ÖØ-öø-ÿ";
const DIGITOS = "0-9";
const SIGNOS = ".,;:!?¿¡()/%$#&'\"°ºª+*_-";
const SOLO_PERMITIDOS = new RegExp(`^[${LETRAS}${DIGITOS} ${SIGNOS}]+$`);
const ESPACIOS_REPETIDOS = / {2,}/g;

/**
 * Deja la explicación en su forma canónica: `null` si no hay (omitida, `null` o en blanco); el texto recortado si es válido; si no,
 * `EXPLICACION_INVALIDA`. Las letras con tilde se componen (NFC) ANTES de mirar la lista: «é» de una o de dos piezas es el mismo texto.
 */
export function explicacionDesdeTexto(
  texto: string | null | undefined,
): Resultado<string | null, ErrorDeExplicacion> {
  if (texto === null || texto === undefined) return ok(null);
  const canonico = texto.trim().normalize("NFC").replace(ESPACIOS_REPETIDOS, " ");
  if (canonico === "") return ok(null);
  if (canonico.length > LARGO_MAXIMO_DE_LA_EXPLICACION || !SOLO_PERMITIDOS.test(canonico)) {
    return err("EXPLICACION_INVALIDA");
  }
  return ok(canonico);
}
