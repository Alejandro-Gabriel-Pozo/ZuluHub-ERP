import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";

/**
 * Por qué un texto que se va a mostrar no sirve (marcas y planes, §B.3 y §B.4). Los códigos son
 * estables: la pantalla los traduce, el dominio no redacta mensajes.
 */
export type MotivoDeTextoInvalido = "CARACTER_PROHIBIDO" | "VACIO" | "DEMASIADO_LARGO";

/**
 * Lo que un texto visible no puede traer: caracteres de control (`\p{Cc}`), de formato (`\p{Cf}`: ancho
 * cero, marcas de dirección bidireccional, guion blando), sustitutos sueltos (`\p{Cs}`: la base no los
 * guarda) y `<` o `>` (nada de marcado). Se mira el texto TAL CUAL llega, antes de recortarlo: un
 * salto de línea al final es un defecto del dato, no un blanco que se perdona.
 */
const PROHIBIDO = /[\p{Cc}\p{Cf}\p{Cs}<>]/u;

/**
 * Valida y deja en su forma canónica un texto que ve el usuario (nombre visible de una marca, reemplazo
 * del vocabulario): sin caracteres prohibidos, recortado, en NFC y de 1 a `largoMaximo` caracteres
 * (puntos de código, como cuenta la base). Devuelve el texto canónico: el largo se mide DESPUÉS de
 * normalizar, que puede acortarlo. Es la misma regla que la base repite como defensa en profundidad y
 * que hoy valida `ZULUHUB_NOMBRE_DE_MARCA`.
 */
export function validarTextoVisible(
  texto: string,
  largoMaximo: number,
): Resultado<string, MotivoDeTextoInvalido> {
  if (PROHIBIDO.test(texto)) return err("CARACTER_PROHIBIDO");
  const canonico = texto.trim().normalize("NFC");
  if (canonico === "") return err("VACIO");
  if ([...canonico].length > largoMaximo) return err("DEMASIADO_LARGO");
  return ok(canonico);
}
