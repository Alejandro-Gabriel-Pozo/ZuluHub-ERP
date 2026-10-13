import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { validarTextoVisible } from "../../vocabulario/texto-visible";

/**
 * La descripción propia de un producto de la carta (§3.1 y §3.6): texto plano, de 0 a 300 caracteres y a
 * lo sumo 2 saltos de línea, sin HTML ni Markdown (se pinta como texto). Opcional: vacía = no hay bloque.
 */

export const LARGO_MAXIMO_DE_LA_DESCRIPCION = 300;
export const SALTOS_MAXIMOS_DE_LA_DESCRIPCION = 2;

export type MotivoDeDescripcionInvalida =
  "CARACTER_PROHIBIDO" | "DEMASIADO_LARGA" | "DEMASIADOS_SALTOS_DE_LINEA";

/**
 * Devuelve la descripción canónica (recortada, en NFC, con `\n` como único salto) o `null` si no hay
 * ninguna. Los caracteres prohibidos son los de los textos de marca (control, formato, sustitutos sueltos,
 * `<` y `>`), salvo el salto de línea, que acá se permite; el largo cuenta puntos de código, como la base.
 * Un `\r\n` (lo que manda un formulario) vale un salto; un `\r` suelto es un carácter de control.
 */
export function validarDescripcionDeProducto(
  texto: string,
): Resultado<string | null, MotivoDeDescripcionInvalida> {
  const unificado = texto.replaceAll("\r\n", "\n");
  // El salto se cambia por un espacio solo para reusar la regla de los textos visibles; el texto devuelto es el real.
  const linea = validarTextoVisible(
    unificado.replaceAll("\n", " "),
    LARGO_MAXIMO_DE_LA_DESCRIPCION,
  );
  if (!linea.ok) {
    if (linea.error === "VACIO") return ok(null);
    return err(linea.error === "DEMASIADO_LARGO" ? "DEMASIADO_LARGA" : "CARACTER_PROHIBIDO");
  }
  const canonica = unificado.trim().normalize("NFC");
  if (canonica.split("\n").length - 1 > SALTOS_MAXIMOS_DE_LA_DESCRIPCION) {
    return err("DEMASIADOS_SALTOS_DE_LINEA");
  }
  return ok(canonica);
}
