import { ejecutarHumo, type Pedir, type RespuestaDeHumo } from "./ejecutar-humo";

/**
 * `npm run humo`: las pruebas de humo de SOLO LECTURA contra un despliegue (ver `ejecutar-humo.ts`). Las direcciones y la cadena de lectura las carga el dueño en
 * el entorno (`PEDERNAL_HUMO_URL_TECNICA` es la única obligatoria; nada de esto está en el repositorio). Solo pedidos GET, con tiempo límite, sin seguir redirecciones, sin
 * cookies y con el cuerpo acotado. La salida nombra variables, rutas y estados; nunca una dirección ni un cuerpo.
 */

const PLAZO_EN_MS = 10_000;
const TOPE_DEL_CUERPO_EN_BYTES = 65_536;

const pedir: Pedir = async (url, encabezados = {}) => {
  const respuesta = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: { "user-agent": "pedernal-humo", ...encabezados },
    signal: AbortSignal.timeout(PLAZO_EN_MS),
  });
  const mapa: Record<string, string> = {};
  respuesta.headers.forEach((valor, nombre) => {
    mapa[nombre.toLowerCase()] = valor;
  });
  const cookies = respuesta.headers.getSetCookie();
  if (cookies.length > 0) mapa["set-cookie"] = cookies.join("; ");
  const bytes = new Uint8Array(await respuesta.arrayBuffer());
  const cuerpo = new TextDecoder().decode(bytes.subarray(0, TOPE_DEL_CUERPO_EN_BYTES));
  const resultado: RespuestaDeHumo = { estado: respuesta.status, encabezados: mapa, cuerpo };
  return resultado;
};

process.exitCode = await ejecutarHumo({
  entorno: process.env,
  pedir,
  salida: (linea) => console.log(linea),
});
