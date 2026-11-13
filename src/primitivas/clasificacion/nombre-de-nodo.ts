import type { Resultado } from "../resultado/resultado";
import {
  LARGO_MAXIMO_DEL_NOMBRE_DE_ELECCION,
  nombreDeEleccionDesdeTexto,
} from "../texto/nombre-de-eleccion";
import type { MotivoDeTextoInvalido } from "../texto/texto-de-una-linea";

/**
 * FICHA DEL DATO: NOMBRE DE UN NODO DE LA CLASIFICACIÓN COMERCIAL (departamento, categoría y niveles inferiores; ficha de concepto
 * `Pedernal-docs/11-especificaciones/conceptos/clasificacion-comercial-y-seccion-de-la-carta.md` §2 y maqueta aprobada `clasificacion.html`, supuesto S11: hasta 80).
 * Es el mismo texto que el nombre de una sección de la carta (1 a 80, lista de permitidos del catálogo, sin exigir una letra): una sola regla, la de
 * `nombre-de-eleccion.ts`; la columna de la base (`nodo_de_clasificacion.nombre`, 0045) copia ese largo con `texto_de_catalogo_valido`. Único entre hermanos
 * (mismo padre) por `claveDeNombre`. Si algún día el nombre de un nodo necesita otro largo u otras letras, se separa acá sin tocar las secciones.
 */
export const LARGO_MAXIMO_DEL_NOMBRE_DE_NODO = LARGO_MAXIMO_DEL_NOMBRE_DE_ELECCION;

export function nombreDeNodoDesdeTexto(texto: string): Resultado<string, MotivoDeTextoInvalido> {
  return nombreDeEleccionDesdeTexto(texto);
}
