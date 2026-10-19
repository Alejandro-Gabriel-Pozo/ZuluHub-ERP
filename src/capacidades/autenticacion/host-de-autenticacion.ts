import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";

/**
 * La parte de la configuración de ingreso que depende solo del host (web-armazon §4.1). Pura: del host
 * que resolvió el servidor sale TODO lo que cambia entre una instancia de la librería y otra. Cada
 * instancia atiende un único host: su origen es un texto fijo, sin lista de hosts permitidos ni
 * «fallback» (un fallback haría caer un host en otra marca). La lista de hosts es un dato de la base
 * (dominios de las marcas), no código; quien llama ya resolvió el host contra ella.
 */

/** Prefijo de las cookies de ingreso de la aplicación de empresa (la consola, después, usará otro). */
export const PREFIJO_DE_COOKIE = "zh_emp";

/**
 * Prefijo de navegador de TODAS las cookies de ingreso (M1). `__Host-` exige `Secure`, `Path=/` y NINGÚN
 * `Domain`: el navegador rechaza la cookie si alguien (un subdominio del cliente, un proxy) intenta fijarla
 * con alcance de dominio, cosa que `__Secure-` no impide. La cookie de sesión queda `__Host-zh_emp.session_token`.
 */
export const PREFIJO_DE_NAVEGADOR = "__Host-";

/**
 * El encabezado del que la librería saca la IP del cliente para su límite de intentos de ingreso (S3).
 * NO VERIFICADO: no se pudo leer la documentación de Vercel desde acá. Se supone que `x-vercel-forwarded-for`
 * lo fija Vercel en el borde con la IP del cliente y que un cliente no puede inventarlo. Es el valor
 * CONSERVADOR: si resultara no existir, la librería no encuentra IP y el límite usa un solo balde compartido
 * por ruta (más estricto, nunca más laxo); en cambio `x-forwarded-for` lo puede mandar el cliente si la
 * plataforma no lo pisa. Si se confirma otro nombre, se cambia SOLO acá (el adaptador y el armado del
 * pedido de la librería leen esta constante) y se ajusta la prueba que la fija. Es un nombre de
 * encabezado, no un secreto.
 */
export const ENCABEZADO_DE_IP = "x-vercel-forwarded-for";

/** Dónde atiende la librería. Las rutas de Next (`app/api/auth/[...todo]`) tienen que coincidir. */
export const RUTA_BASE_DE_INGRESO = "/api/auth";

const ETIQUETA = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const FORMA_DE_HOST = new RegExp(`^(${ETIQUETA}(?:\\.${ETIQUETA})*)(?::(\\d{1,5}))?$`);
const LARGO_MAXIMO_DE_HOST = 253;
const PUERTO_MAXIMO = 65_535;

export type ConfiguracionDeHost = Readonly<{
  host: string;
  /** Origen de la instancia, sin barra final. Siempre https: la cookie lleva `Secure` y prefijo `__Host-`. */
  baseURL: string;
  /** Los orígenes desde los que se aceptan pedidos con efectos (comprobación de origen de la librería). */
  origenesConfiables: readonly string[];
}>;

/**
 * `host` tiene que venir ya normalizado por la puerta (minúsculas, sin punto final): acá solo se
 * comprueba que sea un nombre de host (etiquetas DNS, puerto opcional) y NO una IP ni algo con barras,
 * credenciales o espacios. Lo que no cumple se rechaza: nunca se arma una instancia para un texto raro.
 */
export function configuracionDeHost(host: string): Resultado<ConfiguracionDeHost, "HOST_INVALIDO"> {
  if (host.length > LARGO_MAXIMO_DE_HOST) return err("HOST_INVALIDO");
  const partes = FORMA_DE_HOST.exec(host);
  if (partes === null) return err("HOST_INVALIDO");
  const nombre = partes[1] as string;
  const puerto = partes[2];
  // Una IP (cuatro grupos de dígitos) no es un nombre: el último tramo de un dominio nunca es solo numérico.
  if (/^\d+$/.test(nombre.slice(nombre.lastIndexOf(".") + 1))) return err("HOST_INVALIDO");
  // Sin puerto vale 1 (dentro del rango); un puerto que no es número da NaN y tampoco entra.
  const numero = Number(puerto ?? "1");
  if (!(numero >= 1 && numero <= PUERTO_MAXIMO)) return err("HOST_INVALIDO");
  const baseURL = `https://${host}`;
  return ok({ host, baseURL, origenesConfiables: [baseURL] });
}
