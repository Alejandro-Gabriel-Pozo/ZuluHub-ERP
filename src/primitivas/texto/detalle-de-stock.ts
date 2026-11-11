import type { Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido } from "./texto-de-una-linea";

/**
 * FICHA DEL DATO: DETALLE DE UN MOVIMIENTO DE STOCK Y MOTIVO DE CANCELAR UN CONTEO (E5 §3.1: «`AJUSTE`/`ANULACION` exigen `detalle`»).
 * Texto de una línea de la lista de permitidos del catálogo, largo 1 a 300: es el tope de `texto_de_catalogo_valido(detalle, 300)` de
 * `movimiento_de_stock_detalle_ck` y de `conteo_fisico_motivo_ck` en la migración 0030 (SUPUESTO de E5: el 300 copia el de la descripción
 * de la carta, que tampoco tiene fuente; se cambia con esta constante y los dos CHECK). No exige letra: «#12» o «2x1» son detalles posibles.
 */
export const LARGO_MAXIMO_DEL_DETALLE_DE_STOCK = 300;

export function detalleDeStockDesdeTexto(texto: string): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_DETALLE_DE_STOCK,
    exigirUnaLetra: false,
  });
}
