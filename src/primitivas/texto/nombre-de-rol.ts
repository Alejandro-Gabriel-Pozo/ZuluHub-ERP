import type { Resultado } from "../resultado/resultado";
import { claveDeNombre } from "./nombre-de-producto";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido } from "./texto-de-una-linea";

/**
 * FICHA DEL DATO: NOMBRE DE UN ROL PROPIO («Cajero», «Encargado de compras»; H4b T4, DEC-0632). Obligatorio, de 1 a 80 caracteres y con al menos una letra; se apoya en `texto-de-una-linea`
 * (lista de PERMITIDOS). Único por empresa sin distinguir mayúsculas ni tildes de composición, también entre los archivados: lo compara la CLAVE (`claveDeNombre`), que la deriva la
 * aplicación y guarda la base (`rol_de_empresa_nombre_uk`). El largo lo repite la base (`rol_de_empresa_nombre_ck`) y lo compara una prueba de integración. Vive acá, una sola vez, para que
 * el dominio, el formulario de la web (T6) y la prueba de la base lo importen. Previene: dos roles «Cajero» y «CAJERO» en la misma empresa y un nombre que la base rechazaría.
 */
export const LARGO_MAXIMO_DEL_NOMBRE_DE_ROL = 80;

export function nombreDeRolDesdeTexto(texto: string): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_NOMBRE_DE_ROL,
    exigirUnaLetra: true,
  });
}

/** La clave con la que se compara el nombre de un rol (la misma regla que el nombre de un producto: NFC y minúsculas). Parte del nombre ya canónico. */
export const claveDeNombreDeRol = (nombreCanonico: string): string => claveDeNombre(nombreCanonico);
