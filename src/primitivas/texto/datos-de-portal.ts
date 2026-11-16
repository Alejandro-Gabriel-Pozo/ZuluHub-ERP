import type { Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido } from "./texto-de-una-linea";

/**
 * FICHAS DEL DATO: LÍNEA Y TÍTULO DEL PORTAL DE LA EMPRESA (migración 0078; diseño `carta-identidad-y-portal-datos-diseno.md` §2.3). Los dos son opcionales: vacío es «el texto por
 * defecto» (vive una vez en el vocabulario). La línea superior va de 1 a 40 y el título de 1 a 60: SUPUESTO (DEC-0483) del orquestador, tomado de la maqueta. La base los copia en los
 * CHECK de `portal_de_empresa` y una prueba falla si difieren. El nombre de la tarjeta (1 a 80) es el MISMO dato que el nombre de la carta (`nombreDeCartaDesdeTexto`): una regla.
 * Los números van escritos acá, una sola vez y sin constante nombrada: una constante `LARGO_…` con un 40 o un 60 haría chocar a cualquier otro 40 o 60 del código (fuente única).
 * Costo de revertir cualquiera: cambiar el número y el CHECK.
 */
export function lineaDelPortalDesdeTexto(texto: string): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: 40,
    exigirUnaLetra: false,
    conSignosDeCatalogo: true,
  });
}

export function tituloDelPortalDesdeTexto(texto: string): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: 60,
    exigirUnaLetra: false,
    conSignosDeCatalogo: true,
  });
}
