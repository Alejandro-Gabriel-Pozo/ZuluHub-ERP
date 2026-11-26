import type { Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido } from "./texto-de-una-linea";

/**
 * FICHA DEL DATO: MOTIVO DE RETIRAR UNA CUENTA DE IMAGEN DECLARADA (0102: `cuenta_de_imagen_declarada.motivo_de_retiro`, brief «Logo de la carta: cuentas declaradas»).
 * Texto de una línea de la lista de permitidos del catálogo, largo 1 a 300: es el tope de `texto_de_catalogo_valido(motivo_de_retiro, 300)` de `cuenta_de_imagen_motivo_ck`
 * (el 300 no tiene otra fuente que el brief, DEC-1411; se cambia con esta constante y el CHECK). No exige letra. La constante NO se exporta a propósito, como la del motivo de una
 * orden de producción. Previene un motivo que la base rechaza recién al guardar y deja una cuenta retirada a medias.
 */
const LARGO_MAXIMO_DEL_MOTIVO_DE_RETIRO_DE_UNA_CUENTA_DE_IMAGEN = 300;

export function motivoDeRetiroDeCuentaDeImagenDesdeTexto(
  texto: string,
): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_MOTIVO_DE_RETIRO_DE_UNA_CUENTA_DE_IMAGEN,
    exigirUnaLetra: false,
  });
}
