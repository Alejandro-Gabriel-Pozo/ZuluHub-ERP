import type { DestinoValidado } from "../capacidades/activos/direccion-externa";
import type { Resultado } from "../primitivas/resultado/resultado";

/**
 * Puerto `ImagenesExternas` (carta, §5.7.1 y §5.7.5): traer UNA imagen de un destino que ya armó `armarDestinoDeLogo` o `armarDestino` (el tipo no se puede
 * fabricar a mano). Es la única puerta por donde el servidor pide algo a un sitio de un tercero por una dirección que cargó un comerciante: ni el host ni
 * la ruta salen de lo pegado, y lo que vuelve se valida byte a byte antes de entregarse.
 */

/** Por qué no se pudo traer. `OCUPADO` es transitorio (no hay lugar para otra conexión ahora); los demás dicen que el destino no sirve. */
export type ErrorDeTraida =
  | "OCUPADO"
  | "SIN_DIRECCION"
  | "DIRECCION_NO_PERMITIDA"
  | "SIN_CONEXION"
  | "TIEMPO_AGOTADO"
  | "ESTADO_INESPERADO"
  | "TIPO_NO_PERMITIDO"
  | "DEMASIADO_GRANDE"
  | "NO_ES_UNA_IMAGEN"
  | "IMAGEN_NO_PERMITIDA";

export interface ImagenesExternas {
  /** WebP ya sin metadatos (EXIF ni XMP), de a lo sumo el lado y el peso del logo. Nunca lanza por lo que haga el tercero. */
  traerLogo(destino: DestinoValidado): Promise<Resultado<Uint8Array, ErrorDeTraida>>;
}
