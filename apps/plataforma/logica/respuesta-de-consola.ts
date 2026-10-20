import type { ErrorParaLaPantalla } from "./errores-de-plataforma";

/**
 * Lo que el servidor de la consola le entrega a la pantalla. `referencia` (PD-XXXX-XXXX) solo viene con un error
 * INESPERADO y la pone el servidor.
 */
export type RespuestaDeConsola<T> =
  { ok: true; dato: T } | { ok: false; error: ErrorParaLaPantalla; referencia?: string };
