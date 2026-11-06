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
 * El conjunto de caracteres, de dónde sale y qué está decidido:
 *  · La lista base de signos (`. , & - ' / ( ) ° + :`) la propuso el orquestador el 2026-11-05 (pedido del dueño: «cuáles son
 *    peligrosos», y que el límite del dato no pase de lo que el PDF puede dibujar). El resto (`º ª " ; # « » ® ™` y las comillas y
 *    guiones tipográficos) lo sumó el ingeniero por ser comunes en razones sociales y estar en WinAnsi.
 *  · COTEJADO con el PDF (`src/adaptadores/pdf/caracteres-del-pdf.ts`, PR #191): todo lo permitido está contenido en lo que el PDF
 *    dibuja (ASCII imprimible; Latin-1 salvo U+00A0, U+00AD y U+00B5; signos de Windows-1252). La revisión independiente de #197
 *    lo confirmó con un barrido del plano básico (informe del orquestador, 2026-11-06).
 *  · Q26 (® y ™ se admiten): DECIDIDO por el dueño, 2026-11-06 («Q26 ok», mensaje directo al orquestador).
 *  · Q25 (el conjunto): cubierta por la decisión del dueño del 2026-11-05 de «una sola lista de caracteres para lo que se imprime»
 *    (tablero del catálogo de datos, respuesta 1 de la auditoría de columnas). La lista exacta es la de este archivo.
 *  Costo de revertir cualquier parte: cambiar las constantes de abajo.
 *
 * Un texto no puede EMPEZAR con `+` ni `-`: abierto en una hoja de cálculo se tomaría por una fórmula (inyección de fórmulas, si
 * algún día se exporta). `=` y `@` ya quedan afuera por no estar en la lista, en cualquier posición; una prueba fija que sigan
 * afuera. Fuente: Q7, DECIDIDO por el dueño, 2026-11-06 (mensaje directo al orquestador, ante la pregunta de si se mantiene el rechazo aunque no deje cargar un comercio como «+Kota»: «Mantener»). Costo asumido: un nombre que empieza con `+` o `-` no se puede cargar tal cual.
 *
 * Los saltos de línea y los tabuladores en los EXTREMOS se recortan y el texto pasa («Juan\n» y «Juan\t» quedan «Juan»): es la
 * normalización de los extremos (`trim`), no un carácter permitido. Adentro del texto se rechazan. Decisión del orquestador,
 * 2026-11-06.
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
// Solo `+` y `-`: `=` y `@` ya los rechaza la lista de permitidos (si no, serían una opción que ninguna prueba distingue).
const EMPIEZA_COMO_FORMULA = /^[+-]/;

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
 * permitido (o un `+` o `-` al principio) se informa antes que el largo, y el largo antes que la falta de letras.
 */
export function textoDeUnaLineaDesdeTexto(
  texto: string,
  reglas: ReglasDelTexto,
): Resultado<string, MotivoDeTextoInvalido> {
  const canonico = texto.trim().normalize("NFC").replace(ESPACIOS, " ");
  if (canonico === "") return err("VACIO");
  if (!soloCaracteresPermitidos(canonico)) return err("CARACTER_PROHIBIDO");
  if (EMPIEZA_COMO_FORMULA.test(canonico)) return err("CARACTER_PROHIBIDO");
  if (largoEnCaracteres(canonico) > reglas.maximo) return err("DEMASIADO_LARGO");
  if (reglas.exigirUnaLetra && !UNA_LETRA.test(canonico)) return err("SIN_LETRAS");
  return ok(canonico);
}
