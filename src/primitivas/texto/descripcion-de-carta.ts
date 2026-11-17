import type { Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido } from "./texto-de-una-linea";

/**
 * FICHA DEL DATO: DESCRIPCIÓN EN LA CARTA (decisión 72). Texto corto que acompaña al producto en la carta. Solo en productos que se
 * venden. Largo 1 a 300: SUPUESTO (DEC-0043) (E2 mínimo §3.2, «el tope de 300 no tiene fuente»), se cambia con una constante y un CHECK.
 */
export const LARGO_MAXIMO_DE_LA_DESCRIPCION_EN_CARTA = 300;

export function descripcionDeCartaDesdeTexto(
  texto: string,
): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DE_LA_DESCRIPCION_EN_CARTA,
    exigirUnaLetra: false,
    conSignosDeCatalogo: true,
  });
}
