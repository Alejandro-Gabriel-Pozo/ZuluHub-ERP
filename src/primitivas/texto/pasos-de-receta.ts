import type { Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido } from "./texto-de-una-linea";

/**
 * FICHA DEL DATO: PASOS DE UNA RECETA (la ficha de cocina aprobada muestra «Pasos» y no existía dónde guardarlos: E6 S-7).
 * Texto de una línea de la lista de permitidos del catálogo, largo 1 a 2000: es el tope de `texto_de_catalogo_valido(pasos, 2000)` de
 * `composicion_pasos_ck` en la migración 0032 (SUPUESTO (DEC-0110) de E6: el 2000 es el de la especificación E6 §3.1, sin otra
 * fuente; se cambia con esta constante y el CHECK). No exige letra. Previene: un texto que la base rechaza recién al guardar o que el PDF de
 * la ficha no puede dibujar. La constante NO se exporta a propósito: otros dos datos (la nota de una parte y el motivo de una submarca) tienen
 * el mismo 2000 por su cuenta y la regla de fuente única los tomaría por el mismo límite; cuando una pantalla necesite el número se decide ahí
 * (hallazgo del informe de E6).
 */
const LARGO_MAXIMO_DE_LOS_PASOS_DE_RECETA = 2000;

export function pasosDeRecetaDesdeTexto(texto: string): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DE_LOS_PASOS_DE_RECETA,
    exigirUnaLetra: false,
  });
}
