import type { ErrorDeEmision } from "../../modulos/fiscal/publico";
import type { Resultado } from "../../primitivas/resultado/resultado";

/**
 * Lo que el transporte HTTP le entrega al adaptador de ARCA (spec H7 facturación §B.5.4). Tres cosas muy
 * distintas, y de ahí sale la clasificación de lo incierto:
 *  - `NO_SALIO`: falló ANTES de abrir la conexión (DNS, conexión rechazada, TLS que no completa, tiempo de
 *    conexión): ni un byte del pedido llegó a ARCA, así que es seguro que no lo procesó;
 *  - `SIN_RESPUESTA`: el pedido pudo haber llegado y no se pudo leer la respuesta completa (tiempo agotado
 *    en cualquier momento después de conectar, corte, respuesta demasiado grande): NO se sabe;
 *  - `RESPUESTA`: la respuesta completa, con su estado HTTP y su cuerpo como texto.
 * Los motivos son códigos cortos (`ECONNREFUSED`, `TIEMPO_AGOTADO`...), nunca el texto de una excepción.
 */
export type RespuestaDeTransporte =
  | Readonly<{ tipo: "RESPUESTA"; estadoHttp: number; cuerpo: string }>
  | Readonly<{ tipo: "NO_SALIO"; motivo: string }>
  | Readonly<{ tipo: "SIN_RESPUESTA"; motivo: string }>;

/** Un POST SOAP con su tiempo límite propio, que cubre TODO: conexión, envío y lectura completa del cuerpo. */
export type PedidoDeTransporte = Readonly<{
  url: string;
  /** Cabecera `SOAPAction` (WSFE: `http://ar.gov.afip.dif.FEV1/<operación>`; WSAA: vacía). */
  accionSoap: string;
  cuerpo: string;
  limiteEnMs: number;
}>;

export type Transporte = (pedido: PedidoDeTransporte) => Promise<RespuestaDeTransporte>;

/** Un resultado que puede fallar con los errores de emisión del puerto (sin credencial, servicio caído...). */
export type ResultadoDeEmision<T> = Resultado<T, ErrorDeEmision>;
