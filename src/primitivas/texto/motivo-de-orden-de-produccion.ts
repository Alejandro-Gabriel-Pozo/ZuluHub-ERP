import type { Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido } from "./texto-de-una-linea";

/**
 * FICHA DEL DATO: MOTIVO DE CANCELAR O ANULAR UNA ORDEN DE PRODUCCIÓN (E6 §3.1: `orden_de_produccion.motivo`, «cancelar y anular: ≤ 200»).
 * Texto de una línea de la lista de permitidos del catálogo, largo 1 a 200: es el tope de `texto_de_catalogo_valido(motivo, 200)` de `orden_motivo_ck`
 * en la migración 0033 (SUPUESTO (DEC-0119): el 200 es el de la especificación, sin otra fuente; se cambia con esta constante y el CHECK). No exige
 * letra. La constante NO se exporta a propósito, por la misma razón que la de los pasos de una receta (la regla de fuente única la confundiría con
 * el 200 de otro dato). Previene un motivo que la base rechaza recién al guardar o que el PDF no puede dibujar.
 */
const LARGO_MAXIMO_DEL_MOTIVO_DE_UNA_ORDEN = 200;

export function motivoDeOrdenDeProduccionDesdeTexto(
  texto: string,
): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_MOTIVO_DE_UNA_ORDEN,
    exigirUnaLetra: false,
  });
}
