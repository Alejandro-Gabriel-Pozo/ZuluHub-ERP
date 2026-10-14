import { request as pedirPorHttp, type IncomingMessage } from "node:http";
import { request as pedirPorHttps } from "node:https";
import type { Socket } from "node:net";
import { MAXIMO_DE_RESPUESTA_EN_BYTES, TIEMPO_LIMITE_DE_CONEXION_EN_MS } from "./constantes";
import type { RespuestaDeTransporte, Transporte } from "./tipos";

/**
 * Transporte HTTP del adaptador de ARCA sobre `node:http` y `node:https` (sin librerías), con un tiempo límite
 * PROPIO que cubre TODO: la conexión, el envío y la lectura COMPLETA del cuerpo (spec H7 facturación §B.5.4).
 * Los SDK de terceros cancelan su temporizador al recibir las cabeceras: un servidor que manda las cabeceras y
 * se cuelga los deja esperando para siempre. Acá el temporizador corre hasta el último byte del cuerpo.
 *
 * TLS con los valores por defecto de Node: nada se afloja (si ARCA exigiera parámetros débiles, se le informa
 * al dueño, no se acepta). Una conexión nueva por pedido (`agent: false`): son pocas llamadas y así no hay
 * estado compartido entre pedidos.
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
}>;

const FORMA_DE_CODIGO = /^[A-Z0-9_]{2,60}$/;

/** El código de un error de red de Node (`ECONNREFUSED`...), o uno genérico: nunca su mensaje. */
export function codigoDeError(error: unknown): string {
  const codigo = (error as { code?: unknown } | null)?.code;
  return typeof codigo === "string" && FORMA_DE_CODIGO.test(codigo) ? codigo : "FALLA_DE_RED";
}

export function crearTransporteHttp(opciones: OpcionesDelTransporte = {}): Transporte {
  const conexionEnMs = opciones.conexionEnMs ?? TIEMPO_LIMITE_DE_CONEXION_EN_MS;
  const maximoDeBytes = opciones.maximoDeBytes ?? MAXIMO_DE_RESPUESTA_EN_BYTES;

  return (pedido) =>
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
}
