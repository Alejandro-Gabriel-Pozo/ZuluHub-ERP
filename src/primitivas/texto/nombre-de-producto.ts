import type { Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido } from "./texto-de-una-linea";

/**
 * FICHA DEL DATO: NOMBRE DE PRODUCTO (E2 mínimo, `e2-catalogo-minimo-especificacion.md` §3.2). Cómo se llama lo que se compra, se
 * elabora o se vende. Se apoya en `texto-de-una-linea` (lista de PERMITIDOS) y exige al menos una letra. Largo 1 a 120 (diseño de
 * datos `catalogo-y-stock-diseno-de-datos.md:535`). Único por empresa sin distinguir mayúsculas ni tildes de composición, también entre
 * los desactivados (decisión 122): lo compara la CLAVE (`claveDeNombre`: NFC y minúsculas), que la deriva la aplicación y guarda la base.
 * Se congela en cada línea del ticket. Previene: dos productos «Café» y «CAFÉ», y un nombre que el PDF no puede dibujar.
 */
export const LARGO_MAXIMO_DEL_NOMBRE_DE_PRODUCTO = 120;

export function nombreDeProductoDesdeTexto(
  texto: string,
): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_NOMBRE_DE_PRODUCTO,
    exigirUnaLetra: true,
  });
}

/** La clave con la que se compara un nombre: NFC y minúsculas (`Café` y `CAFÉ` colisionan). Parte del nombre ya canónico. */
export function claveDeNombre(nombreCanonico: string): string {
  return nombreCanonico.normalize("NFC").toLowerCase();
}
