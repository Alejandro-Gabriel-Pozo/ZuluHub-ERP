import { request as pedirPorHttp, type IncomingMessage } from "node:http";
import { request as pedirPorHttps } from "node:https";
import type { Socket } from "node:net";
import { DEFAULT_CIPHERS } from "node:tls";
import { MAXIMO_DE_RESPUESTA_EN_BYTES, TIEMPO_LIMITE_DE_CONEXION_EN_MS } from "./constantes";
import type { PedidoDeTransporte, RespuestaDeTransporte, Transporte } from "./tipos";

/**
 * Transporte HTTP del adaptador de ARCA sobre `node:http` y `node:https` (sin librerías), con un tiempo límite
 * PROPIO que cubre TODO: la conexión, el envío y la lectura COMPLETA del cuerpo (spec H7 facturación §B.5.4).
 * Los SDK de terceros cancelan su temporizador al recibir las cabeceras: un servidor que manda las cabeceras y
 * se cuelga los deja esperando para siempre. Acá el temporizador corre hasta el último byte del cuerpo.
 *
 * TLS con los valores por defecto de Node: por defecto nada se afloja. Excepción única, declarada, para los
 * dominios de ARCA (`DOMINIOS_DE_ARCA_CON_TLS_COMPATIBLE`), por decisión del dueño del 18/11/2026: si el handshake
 * estricto falla con un motivo de la lista cerrada (`EPROTO_DH_KEY_TOO_SMALL`: el servidor de ARCA ofrece un DH de
 * 1024 bits y Node 24 pide más), y solo si no salió ni un byte del pedido (`NO_SALIO`), se reintenta UNA vez con
 * `@SECLEVEL=1` (el piso mínimo que admite DH de 1024). Nunca se toca `rejectUnauthorized` ni la verificación del
 * certificado, ni `minVersion`, ni se baja a SECLEVEL=0. Para apagarla: vaciar la constante de dominios.
 * Una conexión nueva por pedido (`agent: false`): son pocas llamadas y así no hay estado compartido entre pedidos.
 *
 * Distingue en qué fase falló, que es lo que decide si un pedido «seguro no salió» o «no se sabe»:
 *  - antes de que la conexión (y el TLS) esté abierta, NO salió ni un byte del pedido: `NO_SALIO`;
 *  - desde ahí, cualquier falla (tiempo agotado, corte, respuesta demasiado grande, error de red) es
 *    `SIN_RESPUESTA`: el pedido pudo haber llegado.
 * Los motivos son códigos (`ECONNREFUSED`, `TIEMPO_AGOTADO`...), nunca el texto de la excepción: podría
 * repetir un pedazo de la respuesta o del pedido.
 */

export type OpcionesDelTransporte = Readonly<{
  /** Tiempo para abrir la conexión; por defecto `TIEMPO_LIMITE_DE_CONEXION_EN_MS`. */
  conexionEnMs?: number;
  /** Tope de la respuesta; por defecto `MAXIMO_DE_RESPUESTA_EN_BYTES`. */
  maximoDeBytes?: number;
  /** Deja rastro de que se usó el modo compatible y por qué (nunca datos del pedido). No lanza hacia afuera. */
  registrar?: (detalle: string) => void;
  /**
   * SOLO PARA PRUEBAS: los dominios elegibles para el modo compatible. La composición no lo pasa: en producción
   * rige `DOMINIOS_DE_ARCA_CON_TLS_COMPATIBLE`.
   */
  dominiosConTlsCompatible?: readonly string[];
}>;

/**
 * Los dominios propios de ARCA donde se permite el reintento en modo compatible. Un hostname es elegible si es
 * IGUAL al dominio o termina en `.` + dominio (el hostname sale de `new URL`: minúsculas, sin puerto ni usuario;
 * `afip.gov.ar@evil.com` es el host `evil.com`; `afip.gov.ar.` con punto final NO es elegible: se declara así a
 * propósito, la URL real de ARCA no lo lleva). Fuente única de la excepción. Chequeo: `transporte-http.test.ts`.
 */
export const DOMINIOS_DE_ARCA_CON_TLS_COMPATIBLE: readonly string[] = [
  "afip.gov.ar",
  "arca.gob.ar",
];

/** Los únicos motivos que habilitan el reintento (lista cerrada): lo demostrado con un servidor local de DH 1024. */
const MOTIVOS_QUE_HABILITAN_EL_MODO_COMPATIBLE: readonly string[] = ["EPROTO_DH_KEY_TOO_SMALL"];

/** Los cifrados por defecto de Node con el nivel de seguridad bajado a 1 (DH de 1024 bits), nada más. */
const CIFRADOS_DEL_MODO_COMPATIBLE = `${DEFAULT_CIPHERS}:@SECLEVEL=1`;

/** ¿El hostname de la URL es de un dominio de la lista (igual o subdominio)? Falla cerrado ante una URL ilegible. */
export function esDominioConTlsCompatible(
  url: string,
  dominios: readonly string[] = DOMINIOS_DE_ARCA_CON_TLS_COMPATIBLE,
): boolean {
  let destino: URL;
  try {
    destino = new URL(url);
  } catch {
    return false;
  }
  if (destino.protocol !== "https:") return false;
  const host = destino.hostname;
  return dominios.some((dominio) => host === dominio || host.endsWith(`.${dominio}`));
}

const FORMA_DE_CODIGO = /^[A-Z0-9_]{2,60}$/;

/**
 * Un error de protocolo TLS (`EPROTO`) solo dice «protocolo»: lo que sirve para saber qué hace falta es el MOTIVO de
 * OpenSSL («unsafe legacy renegotiation disabled», «dh key too small»...). Es un texto fijo de OpenSSL, no del pedido
 * ni de la respuesta. Se acepta solo con esta forma (lista de permitidos): letras, números, espacios, guiones bajos y
 * puntos, hasta 100 caracteres; cualquier otra cosa deja `EPROTO` a secas. Previene: un log de producción que solo
 * dice `EPROTO` y no permite decidir qué hace falta. Chequeo: `transporte-http.test.ts` (reasons raros, largos, con
 * URL o token; un handshake real contra un servidor TLS local).
 */
const FORMA_DE_MOTIVO_TLS = /^[A-Za-z0-9_. ]{1,100}$/;

/**
 * Cómo Node entrega el motivo: en los errores de OpenSSL que llegan por la lectura, como propiedad `reason`; en los
 * que llegan por la escritura (`write EPROTO`, lo que trae un handshake rechazado), la propiedad no existe y el
 * motivo está SOLO dentro del `message`: `…:error:0A000152:SSL routines::unsafe legacy renegotiation disabled:../deps/…/archivo.c:922:`.
 * De ese texto se extrae únicamente el segmento del motivo, que luego pasa por la misma lista de permitidos;
 * el `message` nunca sale.
 */
const MOTIVO_EN_EL_TEXTO_DE_OPENSSL =
  /error:[0-9A-Fa-f]{8}:[A-Za-z0-9_ ]+:[A-Za-z0-9_]*:([A-Za-z0-9_. ]+):[A-Za-z0-9_./-]*\.c:\d+:/;

function motivoTls(error: unknown): string | null {
  const propiedades = error as { reason?: unknown; message?: unknown } | null;
  let motivo: string | null = null;
  if (typeof propiedades?.reason === "string") motivo = propiedades.reason;
  else if (typeof propiedades?.message === "string") {
    motivo = MOTIVO_EN_EL_TEXTO_DE_OPENSSL.exec(propiedades.message)?.[1] ?? null;
  }
  if (motivo === null || !FORMA_DE_MOTIVO_TLS.test(motivo)) return null;
  const normalizado = motivo
    .toUpperCase()
    .replace(/[ .]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalizado === "" ? null : normalizado;
}

/**
 * El código de un error de red de Node (`ECONNREFUSED`...), o uno genérico: nunca su mensaje. Un `EPROTO` con motivo
 * de OpenSSL conocido es `EPROTO_<MOTIVO>` (hasta 60 caracteres en total, que cumple `FORMA_DE_CODIGO`).
 */
export function codigoDeError(error: unknown): string {
  const codigo = (error as { code?: unknown } | null)?.code;
  if (typeof codigo !== "string" || !FORMA_DE_CODIGO.test(codigo)) return "FALLA_DE_RED";
  if (codigo !== "EPROTO") return codigo;
  const motivo = motivoTls(error);
  return motivo === null ? codigo : `${codigo}_${motivo}`.slice(0, 60).replace(/_+$/, "");
}

export function crearTransporteHttp(opciones: OpcionesDelTransporte = {}): Transporte {
  const conexionEnMs = opciones.conexionEnMs ?? TIEMPO_LIMITE_DE_CONEXION_EN_MS;
  const maximoDeBytes = opciones.maximoDeBytes ?? MAXIMO_DE_RESPUESTA_EN_BYTES;
  const dominios = opciones.dominiosConTlsCompatible ?? DOMINIOS_DE_ARCA_CON_TLS_COMPATIBLE;

  const registrar = (detalle: string): void => {
    try {
      opciones.registrar?.(detalle);
    } catch {
      // Un registro que falla no cambia lo que se devuelve.
    }
  };

  /** Un solo intento. `compatible`: con `@SECLEVEL=1`; si no, los valores por defecto de Node. */
  const intentar = (pedido: PedidoDeTransporte, compatible: boolean) =>
    new Promise<RespuestaDeTransporte>((resolver) => {
      const destino = new URL(pedido.url);
      const esHttps = destino.protocol === "https:";
      const cuerpo = Buffer.from(pedido.cuerpo, "utf8");
      // Hasta que la conexión (y su TLS) se abre no sale ni un byte del pedido.
      let conectado = false;
      let terminado = false;

      const terminar = (respuesta: RespuestaDeTransporte): void => {
        if (terminado) return;
        terminado = true;
        clearTimeout(limiteTotal);
        clearTimeout(limiteDeConexion);
        pedidoHttp.destroy();
        resolver(respuesta);
      };
      const fallar = (motivo: string): void =>
        terminar({ tipo: conectado ? "SIN_RESPUESTA" : "NO_SALIO", motivo });

      const alResponder = (respuesta: IncomingMessage): void => {
        const partes: Buffer[] = [];
        let total = 0;
        respuesta.on("data", (parte: Buffer) => {
          total += parte.length;
          if (total > maximoDeBytes) {
            fallar("RESPUESTA_DEMASIADO_GRANDE");
            return;
          }
          partes.push(parte);
        });
        respuesta.on("end", () =>
          terminar({
            tipo: "RESPUESTA",
            estadoHttp: respuesta.statusCode ?? 0,
            cuerpo: Buffer.concat(partes).toString("utf8"),
          }),
        );
        respuesta.on("error", (error) => fallar(codigoDeError(error)));
        // Un corte antes de la última parte: se cierra sin haber terminado.
        respuesta.on("close", () => {
          if (!respuesta.complete) fallar("CONEXION_CORTADA");
        });
      };

      const pedidoHttp = (esHttps ? pedirPorHttps : pedirPorHttp)(
        destino,
        {
          method: "POST",
          agent: false,
          ...(compatible ? { ciphers: CIFRADOS_DEL_MODO_COMPATIBLE } : {}),
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            "Content-Length": String(cuerpo.length),
            SOAPAction: `"${pedido.accionSoap}"`,
            Connection: "close",
          },
        },
        alResponder,
      );
      const limiteTotal = setTimeout(() => fallar("TIEMPO_AGOTADO"), pedido.limiteEnMs);
      const limiteDeConexion = setTimeout(() => fallar("TIEMPO_DE_CONEXION"), conexionEnMs);
      pedidoHttp.on("socket", (socket: Socket) => {
        const alConectar = (): void => {
          conectado = true;
          clearTimeout(limiteDeConexion);
        };
        if (socket.connecting) socket.once(esHttps ? "secureConnect" : "connect", alConectar);
        else alConectar();
      });
      pedidoHttp.on("error", (error) => fallar(codigoDeError(error)));
      pedidoHttp.end(cuerpo);
    });

  /**
   * El intento estricto y, solo si falló con un motivo de la lista cerrada, sin que saliera nada del pedido y contra
   * un dominio de ARCA, UN reintento en modo compatible (nunca un tercero). Si el reintento tampoco abre la
   * conexión, se devuelve el error ORIGINAL; si la abre y después falla, se devuelve esa falla (`SIN_RESPUESTA`:
   * el pedido pudo haber llegado, y decir «no salió» sería falso).
   */
  return async (pedido) => {
    const estricto = await intentar(pedido, false);
    if (
      estricto.tipo !== "NO_SALIO" ||
      !MOTIVOS_QUE_HABILITAN_EL_MODO_COMPATIBLE.includes(estricto.motivo) ||
      !esDominioConTlsCompatible(pedido.url, dominios)
    ) {
      return estricto;
    }
    const compatible = await intentar(pedido, true);
    const resultado =
      compatible.tipo === "NO_SALIO"
        ? `tampoco salió (${compatible.motivo})`
        : "la conexión se abrió";
    registrar(
      `[arca] TLS en modo compatible (SECLEVEL=1) con ${new URL(pedido.url).hostname} por ${estricto.motivo}: ${resultado}`,
    );
    return compatible.tipo === "NO_SALIO" ? estricto : compatible;
  };
}
