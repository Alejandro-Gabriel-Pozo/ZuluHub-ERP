import { err, ok, type Resultado } from "../resultado/resultado";

/**
 * FICHAS DEL DATO: CÓDIGO INTERNO Y CÓDIGO DE BARRAS DE UN PRODUCTO (`catalogo-y-stock-diseno-de-datos.md:538-539`, E0 §3.4.2). El
 * interno: letras y dígitos sin tilde, punto, guion y guion bajo, de 1 a 40 caracteres (`LARGO_MAXIMO_DEL_CODIGO_DE_PRODUCTO`). El de
 * barras: de 8 a 14 dígitos. Ambos únicos por empresa si existen; vacío = no tiene (se guarda `null`, lo resuelve quien llama).
 */
export const LARGO_MAXIMO_DEL_CODIGO_DE_PRODUCTO = 40;
const CODIGO = new RegExp(`^[A-Za-z0-9._-]{1,${LARGO_MAXIMO_DEL_CODIGO_DE_PRODUCTO}}$`);
const CODIGO_DE_BARRAS = /^[0-9]{8,14}$/;

export function codigoDeProductoDesdeTexto(texto: string): Resultado<string, "CODIGO_INVALIDO"> {
  return CODIGO.test(texto) ? ok(texto) : err("CODIGO_INVALIDO");
}

export function codigoDeBarrasDesdeTexto(
  texto: string,
): Resultado<string, "CODIGO_DE_BARRAS_INVALIDO"> {
  return CODIGO_DE_BARRAS.test(texto) ? ok(texto) : err("CODIGO_DE_BARRAS_INVALIDO");
}
