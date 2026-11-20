import type { Causa } from "./errores-de-arca";
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

/** Los motivos del transporte que son un problema del sistema y no de la cuenta de ARCA, por igualdad exacta (el único prefijo es `EPROTO_`, que arma `transporte-http.ts`). */
const MOTIVO_DE_CONEXION_SEGURA = "EPROTO";
const PREFIJO_DE_MOTIVO_TLS = "EPROTO_";
const MOTIVO_DE_NOMBRE_DEL_CERTIFICADO = "ERR_TLS_CERT_ALTNAME_INVALID";
const MOTIVO_DE_RESPUESTA_GRANDE = "RESPUESTA_DEMASIADO_GRANDE";

/**
 * La causa de una falla de transporte: una conexión segura que no se pudo establecer, o una respuesta fuera de tamaño, son del sistema.
 * Todo lo demás (conexión rechazada, tiempos, cortes, cualquier estado HTTP) es `null`: no se sabe, sale el texto de hoy.
 */
export function causaDeTransporte(respuesta: RespuestaDeTransporte): Causa | null {
  if (respuesta.tipo === "NO_SALIO") {
    const { motivo } = respuesta;
    return motivo === MOTIVO_DE_CONEXION_SEGURA ||
      (motivo.startsWith(PREFIJO_DE_MOTIVO_TLS) && motivo.length > PREFIJO_DE_MOTIVO_TLS.length) ||
      motivo === MOTIVO_DE_NOMBRE_DEL_CERTIFICADO
      ? "PROBLEMA_DEL_SISTEMA"
      : null;
  }
  return respuesta.tipo === "SIN_RESPUESTA" && respuesta.motivo === MOTIVO_DE_RESPUESTA_GRANDE
    ? "PROBLEMA_DEL_SISTEMA"
    : null;
}
