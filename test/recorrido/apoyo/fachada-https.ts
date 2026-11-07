import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as pedirPorHttp } from "node:http";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * La app real exige https (rechaza toda acción cuyo `Origin` no lo sea: `src/capacidades/experiencia/origen.ts`) y Vercel le pone la
 * terminación TLS. Acá la pone esta fachada: un servidor https en 127.0.0.1 con un certificado autofirmado que se genera en cada corrida
 * (nada de claves en el repositorio) y que reenvía tal cual a `next start`, con el `Host` original. El navegador del recorrido acepta
 * ese certificado (`ignoreHTTPSErrors`), y solo ése.
 */
export type FachadaHttps = Readonly<{ puerto: number; cerrar(): Promise<void> }>;

function certificadoPara(host: string): Readonly<{ key: string; cert: string }> {
  const carpeta = mkdtempSync(join(tmpdir(), "recorrido-tls-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        `/CN=${host}`,
        "-addext",
        `subjectAltName=DNS:${host}`,
        "-keyout",
        join(carpeta, "k.pem"),
        "-out",
        join(carpeta, "c.pem"),
      ],
      { stdio: "ignore" },
    );
    return {
      key: readFileSync(join(carpeta, "k.pem"), "utf8"),
      cert: readFileSync(join(carpeta, "c.pem"), "utf8"),
    };
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
}

export async function levantarFachadaHttps(
  host: string,
  puertoDeLaApp: number,
): Promise<FachadaHttps> {
  const servidor: Server = createServer(certificadoPara(host), (entrante, saliente) => {
    const reenviado = pedirPorHttp(
      {
        host: "127.0.0.1",
        port: puertoDeLaApp,
        path: entrante.url,
        method: entrante.method,
        headers: entrante.headers,
      },
      (respuesta) => {
        saliente.writeHead(respuesta.statusCode ?? 502, respuesta.headers);
        respuesta.pipe(saliente);
      },
    );
    reenviado.on("error", () => {
      saliente.writeHead(502).end();
    });
    entrante.pipe(reenviado);
  });
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  return {
    puerto: (servidor.address() as AddressInfo).port,
    cerrar: () =>
      new Promise<void>((resolver) => {
        servidor.closeAllConnections();
        servidor.close(() => resolver());
      }),
  };
}
