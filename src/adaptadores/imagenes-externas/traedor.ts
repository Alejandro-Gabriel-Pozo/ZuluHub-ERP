import { lookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { request as pedirPorHttps, type RequestOptions } from "node:https";
import type { DestinoValidado } from "../../capacidades/activos/direccion-externa";
import { analizarFoto } from "../../capacidades/activos/limpieza";
import {
  LADO_MAXIMO_DE_LOGO_EXTERNO,
  PESO_MAXIMO_DE_LOGO_EXTERNO,
} from "../../capacidades/activos/proveedores-de-imagen";
import { direccionDeRedPermitida } from "../../capacidades/activos/red";
import type { ErrorDeTraida, ImagenesExternas } from "../../puertos/imagenes-externas";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";

/**
 * El traedor seguro (carta, §5.7.4, S1 a S9). Pide UNA imagen a un destino ya armado desde la plantilla del proveedor y la devuelve validada. Cada paso cierra
 * una puerta por donde un tercero (o un nombre mal puesto) llevaría al servidor a donde no debe o lo dejaría colgado:
 *  - Destino: solo un `DestinoValidado` (host literal del catálogo, ruta fija, sin consulta). El nombre se resuelve acá y TODAS las direcciones tienen que ser
 *    públicas (`direccionDeRedPermitida`); se conecta a esa dirección ya resuelta (no se vuelve a resolver: no hay reenlace de DNS) con el nombre solo para SNI y
 *    para verificar el certificado.
 *  - Sin redirecciones: cualquier estado que no sea 200 se corta. Sin compresión (`identity`) y con cabeceras de salida fijas; ninguna cabecera de la respuesta se reenvía.
 *  - Tope de bytes por lo que LLEGA (no por lo que dice `Content-Length`), conexión de a lo sumo `conexionMs`, tiempo total de `totalMs` (cubre también la respuesta que
 *    se cuelga después de los encabezados) y de a lo sumo `simultaneas` pedidos a la vez: el resto se rechaza sin conectar.
 *  - Lo que vuelve: `Content-Type: image/webp`, cabecera RIFF/WEBP real, sin animación, de 1 a 240 de lado; se le quitan EXIF y XMP.
 * Es la única carpeta (con el adaptador de ARCA) que importa `node:https` y `node:dns`: una regla de arquitectura lo exige (`conexiones-salientes-solo-en-adaptadores`).
 */

export const LIMITES_DEL_TRAEDOR = {
  pesoMaximo: PESO_MAXIMO_DE_LOGO_EXTERNO,
  conexionMs: 2_000,
  totalMs: 4_000,
  simultaneas: 8,
} as const;

export type LimitesDelTraedor = { -readonly [K in keyof typeof LIMITES_DEL_TRAEDOR]: number };

/** Lo que se reemplaza SOLO en pruebas (un servidor de bucle local en vez de internet); en producción rigen los valores de `traerImagenExterna`. */
export type DependenciasDelTraedor = Readonly<{
  resolver: (host: string) => Promise<readonly string[]>;
  direccionPermitida: (ip: string) => boolean;
  solicitar: (
    opciones: RequestOptions,
    alResponder: (respuesta: IncomingMessage) => void,
  ) => ReturnType<typeof pedirPorHttps>;
  puerto: number;
  limites: LimitesDelTraedor;
}>;

const TIPO_ADMITIDO = "image/webp";

/** Las ÚNICAS cabeceras que salen: nada de cookies, credenciales ni lo que la persona tenga en su pedido. */
const CABECERAS_DE_SALIDA = {
  Accept: TIPO_ADMITIDO,
  "Accept-Encoding": "identity",
  "User-Agent": "pedernal-carta/1",
  Connection: "close",
} as const;

async function resolverPorDns(host: string): Promise<readonly string[]> {
  const direcciones = await lookup(host, { all: true });
  return direcciones.map((d) => d.address);
}

export const DEPENDENCIAS_DE_PRODUCCION: DependenciasDelTraedor = {
  resolver: resolverPorDns,
  direccionPermitida: direccionDeRedPermitida,
  solicitar: pedirPorHttps,
  puerto: 443,
  limites: { ...LIMITES_DEL_TRAEDOR },
};

function validarImagen(bytes: Uint8Array): Resultado<Uint8Array, ErrorDeTraida> {
  const analisis = analizarFoto(bytes);
  if (!analisis.ok) return err("NO_ES_UNA_IMAGEN");
  const { cabecera } = analisis.valor;
  if (cabecera.formato !== "webp") return err("NO_ES_UNA_IMAGEN");
  const { ancho, alto, animado } = cabecera;
  // El lector de cabeceras ya garantiza lado mínimo 1: solo falta el máximo.
  if (animado || ancho > LADO_MAXIMO_DE_LOGO_EXTERNO || alto > LADO_MAXIMO_DE_LOGO_EXTERNO) {
    return err("IMAGEN_NO_PERMITIDA");
  }
  return ok(analisis.valor.bytes);
}

function pedirBytes(
  d: DependenciasDelTraedor,
  destino: DestinoValidado,
  direccion: string,
  senal: AbortSignal,
): Promise<Resultado<Uint8Array, ErrorDeTraida>> {
  return new Promise((resolver) => {
    let esperaDeConexion: ReturnType<typeof setTimeout> | undefined;
    const terminar = (resultado: Resultado<Uint8Array, ErrorDeTraida>): void => {
      // Resolver dos veces una promesa no hace nada: el primer resultado manda y los siguientes caen solos.
      clearTimeout(esperaDeConexion);
      resolver(resultado);
    };
    const falla = (): ErrorDeTraida => (senal.aborted ? "TIEMPO_AGOTADO" : "SIN_CONEXION");

    const solicitud = d.solicitar(
      {
        host: direccion,
        port: d.puerto,
        method: "GET",
        path: destino.ruta,
        servername: destino.host,
        headers: { Host: destino.host, ...CABECERAS_DE_SALIDA },
        agent: false,
        signal: senal,
      },
      (respuesta) => {
        const cortar = (error: ErrorDeTraida): void => {
          respuesta.destroy();
          solicitud.destroy();
          terminar(err(error));
        };
        if (respuesta.statusCode !== 200) return cortar("ESTADO_INESPERADO");
        if (String(respuesta.headers["content-type"]).toLowerCase() !== TIPO_ADMITIDO) {
          return cortar("TIPO_NO_PERMITIDO");
        }
        const declarado = Number(respuesta.headers["content-length"]);
        if (declarado > d.limites.pesoMaximo) return cortar("DEMASIADO_GRANDE");
        const trozos: Buffer[] = [];
        let total = 0;
        respuesta.on("data", (trozo: Buffer) => {
          total += trozo.length;
          if (total > d.limites.pesoMaximo) return cortar("DEMASIADO_GRANDE");
          trozos.push(trozo);
        });
        respuesta.on("end", () => {
          terminar(respuesta.complete ? ok(new Uint8Array(Buffer.concat(trozos))) : err(falla()));
        });
        // Sin escucha de «error»: Node no lo lanza si nadie lo escucha, y el corte llega por «close» (con `complete` en falso).
        respuesta.on("close", () => terminar(err(falla())));
      },
    );
    solicitud.on("error", () => terminar(err(falla())));
    solicitud.on("socket", (socket) => {
      esperaDeConexion = setTimeout(() => {
        solicitud.destroy();
        terminar(err("TIEMPO_AGOTADO"));
      }, d.limites.conexionMs);
      socket.once("encrypted" in socket ? "secureConnect" : "connect", () => {
        clearTimeout(esperaDeConexion);
      });
    });
    solicitud.end();
  });
}

/** Resuelve el nombre y exige que TODAS las direcciones sean públicas; devuelve la primera, la única a la que se conecta. */
async function direccionPublicaDe(
  d: DependenciasDelTraedor,
  host: string,
  senal: AbortSignal,
): Promise<Resultado<string, ErrorDeTraida>> {
  const aborto = new Promise<never>((_, rechazar) => {
    senal.addEventListener("abort", rechazar);
  });
  let direcciones: readonly string[];
  try {
    direcciones = await Promise.race([d.resolver(host), aborto]);
  } catch {
    return err(senal.aborted ? "TIEMPO_AGOTADO" : "SIN_DIRECCION");
  }
  const [primera] = direcciones;
  if (primera === undefined) return err("SIN_DIRECCION");
  return direcciones.every(d.direccionPermitida) ? ok(primera) : err("DIRECCION_NO_PERMITIDA");
}

/**
 * El traedor con sus dependencias a la vista. `crearTraedor(DEPENDENCIAS_DE_PRODUCCION)` es el de verdad; las pruebas pasan un servidor de bucle local y límites
 * chicos. El contador de pedidos activos es de cada traedor.
 */
export function crearTraedor(d: DependenciasDelTraedor): ImagenesExternas {
  let activos = 0;
  return {
    async traerLogo(destino) {
      if (activos >= d.limites.simultaneas) return err("OCUPADO");
      activos += 1;
      const control = new AbortController();
      const plazo = setTimeout(() => control.abort(), d.limites.totalMs);
      try {
        const direccion = await direccionPublicaDe(d, destino.host, control.signal);
        if (!direccion.ok) return direccion;
        const bytes = await pedirBytes(d, destino, direccion.valor, control.signal);
        return bytes.ok ? validarImagen(bytes.valor) : bytes;
      } finally {
        clearTimeout(plazo);
        activos -= 1;
      }
    },
  };
}

/** El traedor de producción: la única instancia que arma la composición. */
export function crearTraedorDeProduccion(): ImagenesExternas {
  return crearTraedor(DEPENDENCIAS_DE_PRODUCCION);
}
