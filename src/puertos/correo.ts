/**
 * Puerto `correo` (ADR-007): el envío de un mail es un efecto externo. Nunca se llama desde adentro
 * de una transacción: lo ejecuta el procesador de la cola de trabajos.
 *
 * Cada envío lleva una clave de idempotencia: el proveedor (si la admite) no manda dos veces el mismo
 * mensaje aunque se repita la llamada. Una repetición debe llevar EXACTAMENTE el mismo mensaje.
 */
export type MensajeDeCorreo = Readonly<{
  /** Una sola dirección de destino. */
  para: string;
  asunto: string;
  /** Texto plano. */
  texto: string;
}>;

export type ResultadoDeEnvio =
  | Readonly<{
      tipo: "ENVIADO";
      /** Identificador que dio el proveedor, si lo dio (sirve para diagnóstico). */
      idDelProveedor: string | null;
    }>
  | Readonly<{
      tipo: "FALLO";
      /** `true`: reintentar no sirve (por ejemplo, una dirección inválida). */
      definitivo: boolean;
      /** Sin secretos: ni claves, ni el enlace, ni el cuerpo del mensaje. */
      motivo: string;
    }>;

export interface Correo {
  /**
   * Envía el mensaje. Los fallos previstos (red, rechazo del proveedor) vuelven como `FALLO`; una
   * clave vacía es un defecto del llamador y lanza `RangeError`.
   */
  enviar(mensaje: MensajeDeCorreo, claveDeIdempotencia: string): Promise<ResultadoDeEnvio>;
}
