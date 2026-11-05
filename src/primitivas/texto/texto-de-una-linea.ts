import { largoEnCaracteres } from "../contacto/una-linea";
import { err, ok, type Resultado } from "../resultado/resultado";

/**
 * TEXTO DE UNA LÍNEA PARA PERSONAS Y EMPRESAS: la regla común de lo que se escribe como nombre, razón social o domicilio libre y se
 * imprime en un comprobante. Vive acá una sola vez; `nombre-o-razon-social.ts` y `domicilio/domicilio-libre.ts` se apoyan en ella.
 * Previene: un salto de línea, un carácter invisible o de dirección de texto invertida (bidi) en un dato que se imprime (factura,
 * PDF, mail); un tope que corta un emoji al medio; y que "é" escrita de una o de dos piezas sean dos textos distintos. Los CHECK de la
 * base (`texto_fiscal_valido`) rechazan control y largo, pero NO el resto: esta regla es más estricta a propósito y la base queda
 * como defensa en profundidad. Puro: sin reloj ni azar. Fuente: pedido del dueño, 2026-11-05 («cuáles son peligrosos»: caracteres
 * de control, marcas bidi, ceros de ancho cero, invisibles, emojis, etiquetas); la lista exacta de caracteres admitidos está
 * pendiente de su aprobación (SUPUESTO).
 */
export type MotivoDeTextoInvalido = "VACIO" | "DEMASIADO_LARGO" | "CARACTER_PROHIBIDO";

/**
 * Lo que un texto de una línea no puede traer: control (`Cc`: saltos de línea, tabuladores), formato invisible (`Cf`: ancho cero,
 * marcas bidi, guion blando), sustitutos sueltos (`Cs`), separadores de línea y de párrafo (`Zl`, `Zp`), `<` y `>` (nada que parezca
 * una etiqueta), los emojis que se dibujan como emoji (`Emoji_Presentation`) y el selector de emoji (U+FE0F). NO se prohíbe
 * `Extended_Pictographic` entero: dejaría afuera ©, ® y ™, que aparecen en marcas comerciales.
 */
const PROHIBIDO = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}<>\p{Emoji_Presentation}️]/u;
const BLANCOS = /\s+/g;

/**
 * Deja el texto en su forma canónica o dice por qué no sirve. En este orden: recorta los extremos; rechaza lo prohibido; pasa a NFC;
 * colapsa los blancos repetidos (también el espacio de no corte) a un solo espacio; y exige de 1 a `maximo` caracteres, contados
 * por carácter (un emoji cuenta uno, como `char_length` de la base). Se conservan las mayúsculas y los acentos tal cual.
 */
export function textoDeUnaLineaDesdeTexto(
  texto: string,
  maximo: number,
): Resultado<string, MotivoDeTextoInvalido> {
  const recortado = texto.trim();
  if (PROHIBIDO.test(recortado)) return err("CARACTER_PROHIBIDO");
  const canonico = recortado.normalize("NFC").replace(BLANCOS, " ");
  if (canonico === "") return err("VACIO");
  if (largoEnCaracteres(canonico) > maximo) return err("DEMASIADO_LARGO");
  return ok(canonico);
}
