import { largoEnCaracteres } from "../contacto/una-linea";
import { err, ok, type Resultado } from "../resultado/resultado";

/**
 * TEXTO DE UNA LÍNEA PARA PERSONAS Y EMPRESAS: la regla común de lo que se escribe como nombre, razón social o domicilio libre y se
 * imprime en un comprobante. Vive acá una sola vez; `nombre-o-razon-social.ts` y `domicilio/domicilio-libre.ts` se apoyan en ella.
 *
 * LISTA DE PERMITIDOS (todo nace cerrado): solo pasa lo que está declarado abajo; cualquier otro carácter se rechaza. Es lo que
 * deja afuera, sin enumerarlos, los de control (saltos de línea, tabuladores), los invisibles y de dirección de texto (bidi), los
 * separadores de línea, `<` y `>` y los emojis. Previene: un dato que se acepta al cargarlo y después no se puede imprimir (el PDF
 * usa la tipografía estándar y falla cerrado con un carácter que no tiene: emoji, hebreo, árabe, ideogramas) o que rompe un informe;
 * un tope que corta un carácter al medio; y que "é" escrita de una o de dos piezas sean dos textos distintos. Los CHECK de la base
 * (`texto_fiscal_valido`) solo rechazan control y largo: esta regla es más estricta a propósito y la base queda como defensa en
 * profundidad. Puro: sin reloj ni azar.
 *
 * SUPUESTO (del ingeniero, revertible; NO aprobado por el dueño): el conjunto exacto de caracteres. Fuente de las intenciones, no de
 * la lista: pedido del dueño, 2026-11-05 («cuáles son peligrosos», y que el límite del dato no pase de lo que el PDF puede dibujar),
 * por el canal del orquestador; la lista base de signos (`. , & - ' / ( ) ° + :`) es la que propuso el orquestador ese día, y el
 * resto (`º ª " ; # « » ® ™` y las comillas y guiones tipográficos) lo sumé yo por ser comunes en razones sociales y estar en
 * WinAnsi. El conjunto de letras es el de Latin-1 (WinAnsi) y NO se pudo contrastar con la tipografía del PDF (su código no está en
 * esta rama): hay que cotejarlo con la sesión del PDF antes de darlo por bueno. Costo de revertir: cambiar las constantes de abajo.
 * Pendiente de decisión del dueño: Q25 (conjunto permitido) y Q26 (® y ™).
 */
export type MotivoDeTextoInvalido =
  "VACIO" | "DEMASIADO_LARGO" | "CARACTER_PROHIBIDO" | "SIN_LETRAS";

/** Letras latinas con tilde, ñ y diéresis: Latin-1 sin `×` ni `÷`, más las letras extra de WinAnsi (Š š Œ œ Ž ž Ÿ). */
const LETRAS = "A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ";
const DIGITOS = "0-9";
/** Los signos admitidos, además del espacio: ver el SUPUESTO de arriba. */
const SIGNOS = ".,&\\-'/()°+:;\"#ºª’“”–—«»®™";

const CARACTER_PERMITIDO = `[${LETRAS}${DIGITOS} ${SIGNOS}]`;
// Sin la bandera `u` a propósito: todo lo permitido es del plano básico, así que un carácter de otro plano (un emoji) se rechaza igual, porque
// sus dos mitades no están en la lista. Con la bandera el resultado sería el mismo; sin ella no queda una opción que ninguna prueba distingue.
const SOLO_PERMITIDOS = new RegExp(`^${CARACTER_PERMITIDO}+$`);
const UNA_LETRA = new RegExp(`[${LETRAS}]`);
const ESPACIOS = /\p{Zs}+/gu;

/** ¿Todo el texto está hecho de caracteres permitidos? Es la lista que el PDF y la pantalla tienen que respetar (una sola fuente). */
export function soloCaracteresPermitidos(texto: string): boolean {
  return SOLO_PERMITIDOS.test(texto);
}

/** Lo que cambia de un dato a otro: el largo máximo y si exige al menos una letra (el nombre sí; un domicilio puede ser solo números). */
export type ReglasDelTexto = Readonly<{ maximo: number; exigirUnaLetra: boolean }>;

/**
 * Deja el texto en su forma canónica o dice por qué no sirve. En este orden: recorta los extremos; pasa a NFC; colapsa los
 * espacios repetidos (también el de no corte y los tipográficos) a un solo espacio; rechaza todo lo que no esté en la lista de
 * permitidos; exige de 1 a `maximo` caracteres, contados por carácter; y, si `exigirUnaLetra`, al menos una letra latina (los
 * dígitos, los signos, `º` y `ª` no cuentan como letra). Se conservan las mayúsculas y los acentos tal cual. Un carácter no
 * permitido se informa antes que el largo, y el largo antes que la falta de letras.
 */
export function textoDeUnaLineaDesdeTexto(
  texto: string,
  reglas: ReglasDelTexto,
): Resultado<string, MotivoDeTextoInvalido> {
  const canonico = texto.trim().normalize("NFC").replace(ESPACIOS, " ");
  if (canonico === "") return err("VACIO");
  if (!soloCaracteresPermitidos(canonico)) return err("CARACTER_PROHIBIDO");
  if (largoEnCaracteres(canonico) > reglas.maximo) return err("DEMASIADO_LARGO");
  if (reglas.exigirUnaLetra && !UNA_LETRA.test(canonico)) return err("SIN_LETRAS");
  return ok(canonico);
}
