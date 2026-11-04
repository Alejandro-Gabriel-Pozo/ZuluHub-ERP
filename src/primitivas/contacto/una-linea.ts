/**
 * Las dos reglas que comparten los datos de contacto de texto (teléfono, web, correo acotado) y que viven acá una sola vez:
 * «una sola línea, sin caracteres de control» y «el largo se cuenta en caracteres, no en unidades de UTF-16». Previene: un
 * salto de línea o un carácter invisible en un dato que se imprime en una factura, y un tope que corta un emoji al medio
 * (los CHECK de la base cuentan con `char_length`, que es por carácter). Puro: sin reloj ni azar.
 */
const CARACTER_DE_CONTROL = /\p{Cc}/u;

/** `true` si no trae saltos de línea, tabuladores ni otros caracteres de control (C0, DEL y C1). */
export function esUnaLineaSinControl(texto: string): boolean {
  return !CARACTER_DE_CONTROL.test(texto);
}

/** El largo en caracteres (un emoji cuenta uno), como `char_length` de Postgres. */
export function largoEnCaracteres(texto: string): number {
  return [...texto].length;
}
