import type { Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido } from "./texto-de-una-linea";

/**
 * FICHA DEL DATO: NOMBRE DE SECCIÓN DE LA CARTA, DE GRUPO DE OPCIONES Y DE OPCIÓN (E2 mínimo §3.2). Largo 1 a 80. No exige letra
 * («2x1» o «12» son nombres posibles de una opción): SUPUESTO (DEC-0043), se cambia con una bandera. Único por empresa (sección), por producto
 * (grupo) y por grupo (opción), comparado por `claveDeNombre`.
 */
export const LARGO_MAXIMO_DEL_NOMBRE_DE_ELECCION = 80;

export function nombreDeEleccionDesdeTexto(
  texto: string,
): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_NOMBRE_DE_ELECCION,
    exigirUnaLetra: false,
    conSignosDeCatalogo: true,
  });
}
