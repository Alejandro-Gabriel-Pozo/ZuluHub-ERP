import type { Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido } from "./texto-de-una-linea";

/**
 * FICHA DEL DATO: MOTIVO DE SUSPENDER LA CUENTA CORRIENTE DE UN CLIENTE (CC-1: `cuenta_del_cliente.motivo_de_suspension`, brief PR-CC-1 §3).
 * Texto de una línea de la lista de permitidos del catálogo, largo 1 a 300: es el tope de `texto_de_catalogo_valido(motivo_de_suspension, 300)` de
 * `cuenta_cliente_motivo_ck` en la migración 0106 (SUPUESTO (DEC-1223) CC-1: el 300 es el del brief, sin otra fuente; se cambia con esta constante y el CHECK). No exige
 * letra. La constante NO se exporta a propósito, por la misma razón que la de otros motivos (la regla de fuente única la confundiría con el 300 de otro dato).
 * Previene un motivo que la base rechaza recién al guardar o que un informe no puede dibujar.
 */
const LARGO_MAXIMO_DEL_MOTIVO_DE_SUSPENSION = 300;

export function motivoDeSuspensionDeCuentaDesdeTexto(
  texto: string,
): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_MOTIVO_DE_SUSPENSION,
    exigirUnaLetra: false,
  });
}
