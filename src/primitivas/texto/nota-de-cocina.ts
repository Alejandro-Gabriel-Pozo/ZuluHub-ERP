import type { Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido } from "./texto-de-una-linea";

/**
 * FICHA DEL DATO: NOTA PARA LA COCINA (SAL-G; `linea_de_comanda.nota` y `renglon_de_envio.nota`, migración 0104). Un texto libre corto por plato («sin cebolla») que sale en el papel de cocina bajo el plato.
 * Texto de una línea con la lista de permitidos del catálogo (la misma que `texto_de_catalogo_valido`, que copia la base: la lista base más `¿ ¡ ? ! % $`), largo 1 a 120 (SUPUESTO (DEC-SAL-006): sin otra fuente; se
 * cambia con esta constante y el CHECK de la base, que no se puede bajar con notas cargadas sin recortarlas). No exige letra. Sin nota = `null`, no el texto vacío: la pantalla manda `""` para quitarla y el servidor
 * lo guarda como ausencia. La nota nunca se interpreta (ni HTML ni formato): se imprime y se muestra como texto. Previene una nota que la base rechaza recién al guardar o que el papel no puede dibujar.
 */
export const LARGO_MAXIMO_DE_LA_NOTA_DE_COCINA = 120;

export function notaDeCocinaDesdeTexto(texto: string): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DE_LA_NOTA_DE_COCINA,
    exigirUnaLetra: false,
    conSignosDeCatalogo: true,
  });
}
