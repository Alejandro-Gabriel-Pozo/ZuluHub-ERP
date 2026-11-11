import type { Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido } from "./texto-de-una-linea";

/**
 * FICHA DEL DATO: NOMBRE DE COCINA (decisión 71). Cómo ve la cocina el producto; vacío = ve el nombre. Solo en productos que se
 * venden. Largo 1 a 80 (E2 mínimo §3.2; el tope no tiene fuente del dueño: SUPUESTO (DEC-0043), se cambia con una constante y un CHECK).
 */
export const LARGO_MAXIMO_DEL_NOMBRE_DE_COCINA = 80;

export function nombreDeCocinaDesdeTexto(texto: string): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_NOMBRE_DE_COCINA,
    exigirUnaLetra: true,
  });
}
