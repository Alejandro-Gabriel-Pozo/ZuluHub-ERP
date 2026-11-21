// SOLO DE PRUEBAS. Lo carga el recorrido del logo con NODE_OPTIONS=--import al lanzar `next start`; ningún archivo de `src/`, de `apps/` ni de `vercel.json` lo nombra (lo vigila
// `test/arquitectura/reglas.test.ts`, el bloque «el módulo de ARCA simulada del recorrido no puede llegar a producción»), así que un despliegue real nunca lo ejecuta.
// Qué hace: el nombre `res.cloudinary.com` (el único proveedor de imágenes que conoce el traedor) se resuelve a una dirección PÚBLICA cualquiera (para que la guarda de red
// real del traedor corra de verdad y lo deje pasar) y la conexión a esa dirección con ese nombre se atiende en un servidor local en 127.0.0.1. Todo lo demás sigue su camino
// (la ARCA simulada y la salida bloqueada de `conectar-arca-simulada.mjs`, que se carga antes).
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import process from "node:process";
import { URL } from "node:url";

const puerto = Number(process.env.PEDERNAL_RECORRIDO_PROVEEDOR_PUERTO);
if (!Number.isInteger(puerto) || puerto <= 0) {
  throw new Error("recorrido: falta el puerto del proveedor de imágenes simulado");
}
const NOMBRE = "res.cloudinary.com";
const DIRECCION_PUBLICA = "8.8.8.8";

const buscarDeVerdad = dns.promises.lookup;
dns.promises.lookup = (host, opciones) =>
  host === NOMBRE
    ? Promise.resolve([{ address: DIRECCION_PUBLICA, family: 4 }])
    : buscarDeVerdad(host, opciones);

const pedirDeVerdad = https.request;
https.request = (...argumentos) => {
  const [opciones, alResponder] = argumentos;
  const esDelProveedor =
    typeof opciones === "object" &&
    opciones !== null &&
    !(opciones instanceof URL) &&
    opciones.servername === NOMBRE &&
    opciones.host === DIRECCION_PUBLICA;
  if (!esDelProveedor) return pedirDeVerdad(...argumentos);
  return http.request(
    {
      host: "127.0.0.1",
      port: puerto,
      path: opciones.path,
      method: opciones.method,
      headers: { ...opciones.headers, "x-recorrido-host": NOMBRE },
      agent: false,
      signal: opciones.signal,
    },
    alResponder,
  );
};
syncBuiltinESMExports();
