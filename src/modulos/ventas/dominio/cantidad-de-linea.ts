import { cantidadDesdeTexto, type Cantidad } from "../../../primitivas/cantidad/cantidad";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * Cota técnica de la cantidad de UNA línea (E4 §3.3, S-3; `linea_cantidad_ck` en 0028): 9999. La forma de la cantidad (decimal exacto,
 * `> 0`, múltiplo del paso del producto) la valida el catálogo al cotizar; acá solo la cota, que es de ventas. Puro.
 */
export const CANTIDAD_MAXIMA_POR_LINEA = cantidadDesdeTexto("9999");

export function comprobarCantidadDeLinea(
  cantidad: Cantidad,
): Resultado<Cantidad, "CANTIDAD_INVALIDA"> {
  return cantidad.unidades > 0n && cantidad.unidades <= CANTIDAD_MAXIMA_POR_LINEA.unidades
    ? ok(cantidad)
    : err("CANTIDAD_INVALIDA");
}
