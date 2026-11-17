import { textoSeguro } from "./saneamiento";
import type { RespuestaDeTransporte } from "./tipos";

/** Lo común a toda clasificación: ¿hay una respuesta HTTP 200 completa que leer? (`clasificar.ts`). */

type CuerpoOFalla =
  | Readonly<{ ok: true; cuerpo: string }>
  /** `llego`: ¿puede el pedido haber llegado a ARCA? (`false` solo si la conexión nunca se abrió). */
  | Readonly<{ ok: false; llego: boolean; motivo: string }>;

/** Por qué no hay respuesta completa que leer. */
export function motivoDeSinRespuesta(
  respuesta: Exclude<RespuestaDeTransporte, { tipo: "RESPUESTA" }>,
): string {
  return respuesta.tipo === "NO_SALIO"
    ? `no salió: ${textoSeguro(respuesta.motivo)}`
    : `sin respuesta completa: ${textoSeguro(respuesta.motivo)}`;
}

/** Solo una respuesta HTTP 200 completa se lee; todo lo demás es una falla, con su motivo. */
export function cuerpoDe(respuesta: RespuestaDeTransporte): CuerpoOFalla {
  if (respuesta.tipo !== "RESPUESTA") {
    return {
      ok: false,
      llego: respuesta.tipo === "SIN_RESPUESTA",
      motivo: motivoDeSinRespuesta(respuesta),
    };
  }
  return respuesta.estadoHttp === 200
    ? { ok: true, cuerpo: respuesta.cuerpo }
    : { ok: false, llego: true, motivo: `HTTP ${respuesta.estadoHttp}` };
}

export const RESPUESTA_ILEGIBLE = "la respuesta de ARCA no se pudo leer";
