/**
 * Puerta por host de la web (W0 la dejó mínima; W4 la completa). Decide qué hace `apps/web/proxy.ts`
 * con un pedido, sin tocar Next: es una función pura de los encabezados, la ruta y la RESOLUCIÓN DEL
 * HOST (que entra como dato: quién la calcula, y contra qué base, no es asunto de acá). Así se prueba y
 * se muta sin levantar nada. Garantías (marcas y planes §B.2.1; armazón web §3.2):
 *  - la identidad del pedido es el `host`, nunca el reenviado por proxies (un cliente lo puede inventar);
 *  - los encabezados internos `x-zh-*` que manda el cliente se descartan siempre: solo la puerta los
 *    pone, y si pasaran, un cliente podría fingir un nonce, una marca o una superficie;
 *  - host desconocido, retirado, inválido, de una superficie que esta app no sirve o con la base caída
 *    = la página neutra (nunca la marca principal): 404, y 503 si la causa fue un fallo de la base;
 *  - nadie entra por una URL interna (`/s/…`): pedida desde afuera es la neutra, aunque el host sea bueno;
 *  - `/api/**` solo en un host APP; en cualquier otro (landing, carta, neutra) es la neutra;
 *  - toda respuesta de la puerta lleva las cabeceras de `cabeceras.ts`.
 * Cada página, acción y ruta vuelve a resolver la puerta por su cuenta: nada de esto es la única barrera.
 */
import { cabecerasDe, politicaDeContenido, type SuperficieDeRespuesta } from "./cabeceras";

/** Prefijo de los encabezados que solo pone la puerta. En minúsculas: `Headers` normaliza los nombres. */
export const PREFIJO_DE_ENCABEZADO_INTERNO = "x-zh-";

/** El encabezado interno con el nonce del pedido: lo lee el servidor para marcar sus `<style>`. */
export const ENCABEZADO_DE_NONCE = "x-zh-nonce";

/** Ruta interna de la página neutra. Nadie entra por URL directa: la puerta reescribe hacia ella. */
export const RUTA_NEUTRA = "/s/neutra";

/**
 * Las superficies que esta app sirve, cada una con su prefijo interno. `CONSOLA` no está: es otra app
 * (`apps/plataforma`), y un host de consola en esta es un host desconocido. `CARTA` está contemplada
 * (reescribe a `/s/carta/…`), pero su pantalla la trae el tramo de la carta, no este.
 */
export const SUPERFICIES_SERVIBLES = ["APP", "LANDING", "CARTA"] as const;
export type SuperficieServible = (typeof SUPERFICIES_SERVIBLES)[number];

export const RUTA_INTERNA_DE: Readonly<Record<SuperficieServible, string>> = Object.freeze({
  APP: "/s/app",
  LANDING: "/s/landing",
  CARTA: "/s/carta",
});

/** Lo único público de una marca que se pinta: su nombre, su tema ya validado y su aplicación. */
export type MarcaPublica = Readonly<{
  /** El nombre visible de la versión vigente. */
  nombre: string;
  /** Los tokens del tema ya validados por `modulos/marcas` (`#rrggbb`); los que falten, rigen los neutros. */
  tema: Readonly<Record<string, string>>;
  /** El host canónico de la aplicación de la marca, ya normalizado; `null` si todavía no tiene. */
  hostDeApp: string | null;
}>;

/** Un host servible con la marca que le corresponde. */
export type PuertaResuelta = Readonly<{
  host: string;
  superficie: SuperficieServible;
  marcaId: string;
  marca: MarcaPublica;
}>;

/** Cómo terminó de resolverse un host. Un fallo de la base NO es «desconocido»: se distingue. */
export type EstadoDeLaResolucion =
  | Readonly<{ tipo: "RESUELTA"; puerta: PuertaResuelta }>
  | Readonly<{ tipo: "DESCONOCIDO" }>
  | Readonly<{ tipo: "NO_DISPONIBLE" }>;

export const HOST_DESCONOCIDO: EstadoDeLaResolucion = Object.freeze({ tipo: "DESCONOCIDO" });
export const HOST_NO_DISPONIBLE: EstadoDeLaResolucion = Object.freeze({ tipo: "NO_DISPONIBLE" });

export type EntradaDePuerta = Readonly<{
  /** Los encabezados tal como llegaron. */
  encabezados: Headers;
  /** El `pathname` del pedido, tal como llegó (sin consulta). */
  ruta: string;
  resolucion: EstadoDeLaResolucion;
  /** Si el despliegue es el de producción (`VERCEL_ENV`): fuera de él nada se indexa. */
  produccion: boolean;
  /** El nonce de este pedido (`nonceDe`). */
  nonce: string;
}>;

export type DecisionDePuerta = Readonly<{
  /** `REESCRIBIR`: el pedido sigue a `rutaInterna`; `SEGUIR`: sigue por su ruta (una API de un host APP). */
  accion: "REESCRIBIR" | "SEGUIR";
  /** A dónde se reescribe; `null` si la acción es `SEGUIR`. */
  rutaInterna: string | null;
  /** El estado que pone la puerta: 404 neutra, 503 si la base falló; `null` si lo decide la página. */
  estado: 404 | 503 | null;
  /** Con qué cara se responde (decide las cabeceras). */
  superficie: SuperficieDeRespuesta;
  /** Los encabezados del pedido que sigue su camino: sin ningún `x-zh-*` del cliente, con los propios. */
  encabezadosDePedido: Headers;
  /** Los encabezados que se suman a la respuesta. */
  encabezadosDeRespuesta: Readonly<Record<string, string>>;
}>;

/**
 * El host del pedido: SOLO la cabecera `host` (con la que Vercel enruta al proyecto). El reenviado
 * y compañía no se miran nunca. Vacío si no vino. Sin normalizar: eso lo hace `normalizarHost` de
 * `modulos/marcas`, la única definición de qué es un host válido.
 */
export function hostDelPedido(encabezados: Headers): string {
  return encabezados.get("host") ?? "";
}

/** Copia los encabezados sin ninguno interno. No modifica el original. */
export function sinEncabezadosInternos(entrantes: Headers): Headers {
  const limpios = new Headers();
  entrantes.forEach((valor, nombre) => {
    if (!nombre.startsWith(PREFIJO_DE_ENCABEZADO_INTERNO)) limpios.append(nombre, valor);
  });
  return limpios;
}

/** Decodifica una ruta; si no es una codificación válida, `null` (y se trata como insegura). */
function decodificada(ruta: string): string | null {
  try {
    return decodeURIComponent(ruta);
  } catch {
    return null;
  }
}

/**
 * ¿Es `/s` o está debajo de `/s/`? Se mira cruda y decodificada, sin distinguir mayúsculas: `/S/app` y
 * `/%73/app` tampoco entran. Las rutas internas solo las alcanza una reescritura de la puerta.
 */
function esRutaInterna(ruta: string): boolean {
  const candidatas = [ruta, decodificada(ruta) ?? ruta].map((r) => r.toLowerCase());
  return candidatas.some((r) => r === "/s" || r.startsWith("/s/"));
}

/**
 * Una ruta que se puede anteponer a un prefijo sin sorpresas: empieza con `/`, sin barra invertida, sin
 * caracteres de control, sin `//` y sin segmentos `.` o `..` (ni escritos como `%2e`).
 */
function esRutaSegura(ruta: string): boolean {
  if (!ruta.startsWith("/") || ruta.includes("\\") || ruta.includes("//")) return false;
  const real = decodificada(ruta);
  if (real === null) return false;
  // eslint-disable-next-line no-control-regex -- justamente se buscan los caracteres de control
  if (/[\u0000-\u001f\u007f]/.test(real)) return false;
  return !real.split("/").some((segmento) => segmento === "." || segmento === "..");
}

const esRutaDeApi = (ruta: string): boolean => ruta === "/api" || ruta.startsWith("/api/");

export function decidirPuerta(entrada: EntradaDePuerta): DecisionDePuerta {
  const { encabezados, ruta, resolucion, produccion, nonce } = entrada;
  const puerta = resolucion.tipo === "RESUELTA" ? resolucion.puerta : null;
  const armar = (
    accion: DecisionDePuerta["accion"],
    rutaInterna: string | null,
    estado: DecisionDePuerta["estado"],
    superficie: SuperficieDeRespuesta,
  ): DecisionDePuerta => {
    const encabezadosDePedido = sinEncabezadosInternos(encabezados);
    // El nonce llega a Next por la propia CSP (así marca sus scripts) y a nuestro servidor por el interno.
    encabezadosDePedido.set("content-security-policy", politicaDeContenido(nonce));
    encabezadosDePedido.set(ENCABEZADO_DE_NONCE, nonce);
    return {
      accion,
      rutaInterna,
      estado,
      superficie,
      encabezadosDePedido,
      encabezadosDeRespuesta: cabecerasDe(superficie, nonce, { produccion }),
    };
  };

  const aLaNeutra = (): DecisionDePuerta =>
    armar("REESCRIBIR", RUTA_NEUTRA, resolucion.tipo === "NO_DISPONIBLE" ? 503 : 404, "NEUTRA");

  if (puerta === null || !esRutaSegura(ruta) || esRutaInterna(ruta)) return aLaNeutra();
  if (esRutaDeApi(ruta)) {
    return puerta.superficie === "APP" ? armar("SEGUIR", null, null, "APP") : aLaNeutra();
  }
  const prefijo = RUTA_INTERNA_DE[puerta.superficie];
  return armar("REESCRIBIR", ruta === "/" ? prefijo : `${prefijo}${ruta}`, null, puerta.superficie);
}
