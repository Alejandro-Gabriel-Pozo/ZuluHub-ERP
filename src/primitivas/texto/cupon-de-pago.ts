/**
 * FICHA DEL DATO: CUPÓN DE PAGO (decisión 129; `caja-y-cobros.md:251`).
 *
 * - Qué es: el número de cupón u operación que el cajero anota al cobrar con tarjeta de débito o crédito. Opcional.
 * - Cómo se escribe: de 1 a `LARGO_MAXIMO_DEL_CUPON` (32) caracteres de la lista permitida: letras sin tilde, dígitos, espacio y
 *   `. _ / -`. No se recortan los extremos ni se cambia nada: o entra tal cual o se rechaza.
 * - Nunca un número de tarjeta: se rechaza con 13 o más dígitos seguidos y también si los dígitos del texto (aunque estén
 *   separados por espacios, puntos, guiones, barras o guiones bajos) forman un número que pasa el control de Luhn y mide entre
 *   13 y 19 dígitos. Previene: que un cajero pegue el número completo de la tarjeta en un campo que queda en la base y en el ticket.
 * - Código de error: `CUPON_INVALIDO`.
 */
import type { Marca } from "../identificadores/marca";
import { err, ok, type Resultado } from "../resultado/resultado";

export type CuponDePago = Marca<string, "CuponDePago">;

export const LARGO_MAXIMO_DEL_CUPON = 32;

/** Lo único que se permite escribir. */
const PERMITIDO = /^[A-Za-z0-9 ._/-]+$/;
/** Desde 13 dígitos seguidos ya puede ser el número de una tarjeta. */
const TRECE_DIGITOS_SEGUIDOS = /[0-9]{13}/;
const LARGO_MINIMO_DE_TARJETA = 13;
const LARGO_MAXIMO_DE_TARJETA = 19;

/** Control de Luhn sobre una cadena de dígitos. */
function pasaLuhn(digitos: string): boolean {
  let suma = 0;
  let duplicar = false;
  for (let i = digitos.length - 1; i >= 0; i -= 1) {
    let valor = digitos.charCodeAt(i) - 48;
    if (duplicar) {
      valor *= 2;
      if (valor > 9) valor -= 9;
    }
    suma += valor;
    duplicar = !duplicar;
  }
  return suma % 10 === 0;
}

function parecePanDeTarjeta(texto: string): boolean {
  const digitos = texto.replace(/[^0-9]/g, "");
  if (TRECE_DIGITOS_SEGUIDOS.test(texto)) return true;
  return (
    digitos.length >= LARGO_MINIMO_DE_TARJETA &&
    digitos.length <= LARGO_MAXIMO_DE_TARJETA &&
    pasaLuhn(digitos)
  );
}

export function cuponDePagoDesdeTexto(texto: string): Resultado<CuponDePago, "CUPON_INVALIDO"> {
  if (texto.length > LARGO_MAXIMO_DEL_CUPON || !PERMITIDO.test(texto) || parecePanDeTarjeta(texto)) {
    return err("CUPON_INVALIDO");
  }
  return ok(texto as CuponDePago);
}
