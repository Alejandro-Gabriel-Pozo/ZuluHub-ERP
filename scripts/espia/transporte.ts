import { request as pedirHttp } from "node:http";
import { request as pedirHttps } from "node:https";
import type { TLSSocket } from "node:tls";

/**
 * Transporte HTTP del espía, con tiempo límite PROPIO que cubre TODO: conexión, TLS, envío y lectura completa del
 * cuerpo (los SDK de terceros cancelaban el temporizador antes de leer el cuerpo: un servidor que manda las cabeceras
 * y después se cuelga los dejaba esperando para siempre). TLS con los valores por defecto de Node: nada se afloja
 * (E13; si ARCA exigiera parámetros débiles, se informa, no se acepta).
 *
 * Distingue en qué fase falló, que es lo que decide si un pedido de autorización «seguro no salió» o «no se sabe»
 * (h7 facturación §B.5.4):
 *  - `ANTES_DE_ENVIAR`: DNS, conexión rechazada, TLS que no completa o tiempo agotado antes de terminar de mandar el
 *    cuerpo (el servidor no pudo haberlo procesado entero);
 *  - `DESPUES_DE_ENVIAR`: tiempo agotado, corte o respuesta demasiado grande después de mandar el cuerpo.
 * Los motivos son códigos (`ECONNREFUSED`, `TIEMPO_AGOTADO`...), nunca el texto de la excepción.
 */

export type DatosDeTls = Readonly<{
  protocolo: string | null;
  cifrado: string | null;
  sujeto: string | null;
  emisor: string | null;
  vence: string | null;
  nombresAlternativos: string | null;
}>;

type Respuesta = Readonly<{
  estado: number;
  cuerpo: string;
  ms: number;
  tls: DatosDeTls | null;
}>;

export type Falla = Readonly<{
  fase: "ANTES_DE_ENVIAR" | "DESPUES_DE_ENVIAR";
  motivo: string;
  ms: number;
}>;

export type Envio =
  Readonly<{ ok: true; respuesta: Respuesta }> | Readonly<{ ok: false; falla: Falla }>;

export type Limites = Readonly<{ totalMs: number; maximoDeBytes?: number }>;

const MAXIMO_POR_DEFECTO = 2 * 1024 * 1024;

function datosDeTls(socket: TLSSocket): DatosDeTls {
  const cert = socket.getPeerCertificate();
  const valor = (v: unknown) => (typeof v === "string" ? v : null);
  const nombre = (n: unknown) =>
    n !== null && typeof n === "object"
      ? Object.entries(n as Record<string, unknown>)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(", ")
      : null;
  return {
    protocolo: socket.getProtocol(),
    cifrado: socket.getCipher().name,
    sujeto: nombre(cert.subject),
    emisor: nombre(cert.issuer),
    vence: valor(cert.valid_to),
    nombresAlternativos: valor(cert.subjectaltname),
  };
}

const codigoDe = (error: unknown): string => {
  const codigo = (error as { code?: unknown } | null)?.code;
  return typeof codigo === "string" && /^[A-Z0-9_]{2,60}$/.test(codigo) ? codigo : "FALLA_DE_RED";
};

/** Un POST con el cuerpo dado, con el tiempo límite total y el tope de tamaño de la respuesta. */
export function enviar(
  url: string,
  cuerpo: string,
  cabeceras: Readonly<Record<string, string>>,
  limites: Limites,
): Promise<Envio> {
  const inicio = performance.now();
  const ms = () => Math.round(performance.now() - inicio);
  const destino = new URL(url);
  const pedir = destino.protocol === "https:" ? pedirHttps : pedirHttp;
  const bytes = Buffer.from(cuerpo, "utf8");
  const maximo = limites.maximoDeBytes ?? MAXIMO_POR_DEFECTO;

  return new Promise<Envio>((resolver) => {
    let terminado = false;
    let cuerpoEnviado = false;
    let tls: DatosDeTls | null = null;
    const terminar = (resultado: Envio) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(temporizador);
      pedido.destroy();
      resolver(resultado);
    };
    const fallar = (motivo: string) =>
      terminar({
        ok: false,
        falla: { fase: cuerpoEnviado ? "DESPUES_DE_ENVIAR" : "ANTES_DE_ENVIAR", motivo, ms: ms() },
      });

    const pedido = pedir(
      destino,
      {
        method: "POST",
        headers: {
          ...cabeceras,
          "Content-Length": String(bytes.length),
          Connection: "close",
        },
      },
      (respuesta) => {
        const partes: Buffer[] = [];
        let total = 0;
        respuesta.on("data", (parte: Buffer) => {
          total += parte.length;
          if (total > maximo) {
            fallar("RESPUESTA_DEMASIADO_GRANDE");
            return;
          }
          partes.push(parte);
        });
        respuesta.on("end", () =>
          terminar({
            ok: true,
            respuesta: {
              estado: respuesta.statusCode ?? 0,
              cuerpo: Buffer.concat(partes).toString("utf8"),
              ms: ms(),
              tls,
            },
          }),
        );
        respuesta.on("error", (e) => fallar(codigoDe(e)));
        respuesta.on("aborted", () => fallar("CONEXION_CORTADA"));
      },
    );
    const temporizador = setTimeout(() => fallar("TIEMPO_AGOTADO"), limites.totalMs);
    pedido.on("socket", (socket) => {
      socket.on("secureConnect", () => {
        tls = datosDeTls(socket as TLSSocket);
      });
    });
    pedido.on("error", (e) => fallar(codigoDe(e)));
    pedido.end(bytes, () => {
      cuerpoEnviado = true;
    });
  });
}
