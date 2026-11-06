// SOLO DE PRUEBAS. Lo carga el recorrido con NODE_OPTIONS=--import al lanzar `next start`; ningún archivo de `src/`, de `apps/` ni de
// `vercel.json` lo nombra (lo vigila `test/arquitectura/reglas.test.ts`, el bloque «el módulo de ARCA simulada del recorrido no puede llegar a producción»), así que un despliegue real nunca lo ejecuta.
// Qué hace: los dos hosts de homologación de ARCA (los únicos que el transporte conoce) se atienden en un servidor local en 127.0.0.1;
// cualquier otro `https.request` falla cerrado, para que una salida a internet de la app se vea en vez de pasar.
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import process from "node:process";
import { URL } from "node:url";

const puerto = Number(process.env.PEDERNAL_RECORRIDO_ARCA_PUERTO);
if (!Number.isInteger(puerto) || puerto <= 0) {
  throw new Error("recorrido: falta el puerto de la ARCA simulada");
}
const HOSTS_DE_ARCA = new Set(["wswhomo.afip.gov.ar", "wsaahomo.afip.gov.ar"]);

https.request = (destino, opciones, alResponder) => {
  const url = destino instanceof URL ? destino : null;
  if (url === null || !HOSTS_DE_ARCA.has(url.hostname)) {
    throw new Error(
      `recorrido: salida a internet bloqueada (${url?.hostname ?? "destino sin URL"})`,
    );
  }
  const pedido = http.request(
    {
      host: "127.0.0.1",
      port: puerto,
      path: `${url.pathname}${url.search}`,
      method: opciones.method,
      headers: { ...opciones.headers, "x-recorrido-host": url.hostname },
      agent: false,
    },
    alResponder,
  );
  // El transporte espera `secureConnect` para saber que la conexión se abrió.
  pedido.on("socket", (socket) => socket.once("connect", () => socket.emit("secureConnect")));
  return pedido;
};
syncBuiltinESMExports();
