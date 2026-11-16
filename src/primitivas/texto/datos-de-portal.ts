import type { Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido } from "./texto-de-una-linea";

/**
 * FICHAS DEL DATO: LÍNEA, TÍTULO Y NOMBRE DE TARJETA DEL PORTAL DE LA EMPRESA (migración 0078; diseño `carta-identidad-y-portal-datos-diseno.md` §2.3 y §2.4).
 * La línea superior (1 a 40) y el título (1 a 60) son opcionales: vacío es «el texto por defecto» (vive una vez en el vocabulario). El nombre de la tarjeta
 * (1 a 80) pisa el de la carta de esa sucursal; vacío es «el nombre de la carta». Los topes 40 y 60 son SUPUESTO (DEC-0483) del orquestador (largo de la maqueta) y el 80 el de
 * `nombre` de la carta: la base los copia en los CHECK de `portal_de_empresa` y `portal_tarjeta` y una prueba falla si difieren.
 * Costo de revertir cualquiera: cambiar la constante y el CHECK.
 */
export const LARGO_MAXIMO_DE_LA_LINEA_DEL_PORTAL = 40;
export const LARGO_MAXIMO_DEL_TITULO_DEL_PORTAL = 60;
export const LARGO_MAXIMO_DEL_NOMBRE_DE_TARJETA = 80;

export function lineaDelPortalDesdeTexto(texto: string): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DE_LA_LINEA_DEL_PORTAL,
    exigirUnaLetra: false,
    conSignosDeCatalogo: true,
  });
}

export function tituloDelPortalDesdeTexto(texto: string): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_TITULO_DEL_PORTAL,
    exigirUnaLetra: false,
    conSignosDeCatalogo: true,
  });
}

export function nombreDeTarjetaDesdeTexto(texto: string): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_NOMBRE_DE_TARJETA,
    exigirUnaLetra: false,
    conSignosDeCatalogo: true,
  });
}
