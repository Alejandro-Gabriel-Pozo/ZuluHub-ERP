import { err, ok, type Resultado } from "../resultado/resultado";
import { CIEN_POR_CIENTO, ESCALA_DE_PORCENTAJE, type Porcentaje } from "./interno";
import { porcentajeATexto, porcentajeDesdeTexto } from "./porcentaje";

/**
 * FICHA DEL DATO: MERMA DE UN INGREDIENTE DE RECETA (B6, `recetas-pantalla.md` §8). Los puntos porcentuales que se pierden de lo bruto: de 0 a menos de 100 (100 % no deja nada
 * para el plato), con hasta 4 decimales. La lista de PERMITIDOS es la forma del texto (un cero o uno o dos dígitos enteros sin ceros a la izquierda y hasta cuatro decimales: `0`, `10.5`, `99.9999`; `05` no, porque no es un decimal canónico), y por eso nada
 * de 100 en adelante, ni negativo, ni con signo, ni con coma, ni en notación científica llega a ser un `Porcentaje`. Es la ÚNICA copia de la regla: el dominio de recetas, la
 * forma que lee el caso de uso y el campo de la pantalla la importan; la base la repite en `componente_perdida_ck` (`0 <= perdida < 100`) y una prueba de integración falla
 * si dejan de coincidir. Previene: la merma escrita en tres lugares (hallazgo H1 de la ficha de Recetas), donde una copia aceptaba lo que otra rechazaba.
 */

/** Los decimales que admite la merma (`numeric(7,4)`). */
export const DECIMALES_DE_MERMA = ESCALA_DE_PORCENTAJE;
/** Los dígitos enteros que admite la merma: dos, porque 100 no se admite. */
export const ENTEROS_DE_MERMA = 2;

/** El texto de una merma permitida. */
export const FORMA_DE_LA_MERMA = /^(0|[1-9][0-9]?)(\.[0-9]{1,4})?$/;

/** Una merma permitida es menor que 100 puntos (un `Porcentaje` llega hasta 100 inclusive; la merma, no). */
export const esMermaPermitida = (porcentaje: Porcentaje): boolean =>
  porcentaje.unidades < CIEN_POR_CIENTO;

/** La merma que dice un texto, o `MERMA_INVALIDA` si no es de la forma permitida. */
export function mermaDesdeTexto(texto: string): Resultado<Porcentaje, "MERMA_INVALIDA"> {
  return typeof texto === "string" && FORMA_DE_LA_MERMA.test(texto)
    ? ok(porcentajeDesdeTexto(texto))
    : err("MERMA_INVALIDA");
}

/** El texto canónico de una merma (4 decimales). */
export const mermaATexto = (merma: Porcentaje): string => porcentajeATexto(merma);
