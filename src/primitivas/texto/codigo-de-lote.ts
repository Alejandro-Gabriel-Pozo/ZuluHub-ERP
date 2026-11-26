import { err, ok, type Resultado } from "../resultado/resultado";

/**
 * FICHA DEL DATO: CÓDIGO DE LOTE (STK-E2a, `dia-uno-stock-diseno-2026-11-25.md` H-1). Letras y dígitos sin tilde, punto y guion, de 1 a 40 caracteres. NO admite el guion bajo: `SIN_ASIGNAR` es el código reservado del lote
 * «sin asignar» y la base (`lote_codigo_ck`) rechaza el resto que no sea texto de catálogo; esta lista de permitidos es MÁS estricta a propósito (todo nace cerrado), así que lo que pasa acá la base lo acepta. El código es la
 * identidad del lote junto con el artículo: `A-1` y `a-1` son lotes distintos (no se pliega a mayúsculas). Puro.
 */
export const LARGO_MAXIMO_DEL_CODIGO_DE_LOTE = 40;
const CODIGO = new RegExp(`^[A-Za-z0-9.-]{1,${LARGO_MAXIMO_DEL_CODIGO_DE_LOTE}}$`);

export function codigoDeLoteDesdeTexto(texto: string): Resultado<string, "CODIGO_INVALIDO"> {
  return CODIGO.test(texto) ? ok(texto) : err("CODIGO_INVALIDO");
}
