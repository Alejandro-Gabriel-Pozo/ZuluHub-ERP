import type { Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido } from "./texto-de-una-linea";

/**
 * FICHA DEL DATO: NOMBRE DE UNA PRESENTACIÓN DE COMPRA («Caja de 5 kg», «Bolsa 25 kg», «Horma»; E9 §3.2, D131). Obligatorio, de 1 a 80 caracteres y con al menos una letra; se apoya en
 * `texto-de-una-linea` (lista de PERMITIDOS). Único por producto sin distinguir mayúsculas: lo compara la CLAVE (`claveDeNombre`), que la deriva la aplicación y guarda la base
 * (`presentacion_nombre_uk`). El largo lo repite la base (`presentacion_nombre_ck`) y lo compara una prueba de integración. Vive acá, una sola vez, para que el dominio, el formulario de la
 * web y la prueba de la base lo importen (antes estaba escrito en el dominio). Previene: un campo de la pantalla con un tope distinto del que acepta el servidor.
 */
export const LARGO_MAXIMO_DEL_NOMBRE_DE_PRESENTACION = 80;

export function nombreDePresentacionDesdeTexto(
  texto: string,
): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_NOMBRE_DE_PRESENTACION,
    exigirUnaLetra: true,
  });
}
