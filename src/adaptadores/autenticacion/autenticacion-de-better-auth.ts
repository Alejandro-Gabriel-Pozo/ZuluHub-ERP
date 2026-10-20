import { betterAuth } from "better-auth";
import { isAPIError } from "better-auth/api";
import {
  codigoPublicoDeIngreso,
  codigoPublicoDeSolicitud,
  sanearUbicacionDeError,
} from "../../capacidades/autenticacion/codigos-de-ingreso";
import { crearCacheAcotada } from "../../capacidades/autenticacion/cache-acotada";
import { cuerpoPublicoDeSesion } from "../../capacidades/autenticacion/cuerpo-de-sesion";
import {
  RUTA_BASE_DE_INGRESO,
  configuracionDeHost,
} from "../../capacidades/autenticacion/host-de-autenticacion";
import { cuerpoPublicoDeIngresoSocial } from "../../capacidades/autenticacion/ingreso-social";
import { rutaPermitida } from "../../capacidades/autenticacion/rutas-permitidas";
import {
  LIMITES_DE_SESION,
  LIMITES_DE_SESION_DE_PLATAFORMA,
  vigenciaDeSesion,
  type LimitesDeSesion,
} from "../../capacidades/autenticacion/vigencia-de-sesion";
import {
  SIN_SESION_DE_PLATAFORMA,
  type EstadoDeSesionDePlataforma,
} from "../../capacidades/autenticacion/estado-de-sesion-de-plataforma";
import { usuarioAuthId } from "../../primitivas/identificadores/marca";
import type { Autenticacion, AutenticacionDePlataforma } from "../../puertos/autenticacion";
import { ErrorDeConfiguracion } from "../postgres/errores";
import type { ClienteDeGoogle } from "./configuracion";
import {
  opcionesDeInstancia,
  type BaseDeDatosDeLaLibreria,
  type DatosDeLaConsola,
} from "./opciones";
import { politicaDePlataforma, type PoliticaDeAudiencia } from "./plataforma/respuestas";
import { hostGuardado, segundoFactorEnDe } from "./sesion-leida";

/**
 * `Autenticacion` sobre Better Auth 1.7.7 (web-armazon §4). Una INSTANCIA de la librería por host de
 * aplicación, guardada en una caché acotada: el origen de cada instancia es un texto fijo (`https://<host>`),
 * así que una cookie, un retorno de Google o una redirección nunca se resuelven contra otro host.
 *
 * No importa `kysely` ni `pg`: la conexión del rol de autenticación llega armada desde la composición
 * (`adaptadores/postgres/conexion-de-autenticacion.ts`). La librería solo se importa en esta carpeta.
 */

export type ConfiguracionDeAutenticacion = Readonly<{
  db: BaseDeDatosDeLaLibreria;
  secreto: string;
  google: ClienteDeGoogle;
  /** Cuántos hosts guardan su instancia a la vez (los menos usados salen primero). */
  capacidadDeLaCache?: number;
  /** Solo para las pruebas: el reloj. */
  reloj?: () => Date;
  limites?: LimitesDeSesion;
  /** Encabezado de confianza para la IP del límite de intentos (S3); por omisión `ENCABEZADO_DE_IP`. Un nombre, no un secreto. */
  encabezadoDeIp?: string;
  /** A dónde vuelve la persona si el ingreso falla. La pantalla de ingreso es de W5. */
  rutaDeError?: string;
  /** Registro del servidor (con detalle). Nada de esto sale en una respuesta. */
  registrar?: (detalle: string) => void;
}>;

/** Lo mismo para la consola de plataforma, más lo que le inyecta su composición. Sin `limites`: son los de plataforma. */
export type ConfiguracionDeAutenticacionDePlataforma = Omit<
  ConfiguracionDeAutenticacion,
  "limites"
> &
  Readonly<{ consola: DatosDeLaConsola; limites?: LimitesDeSesion }>;

export const CAPACIDAD_DE_LA_CACHE = 32;
export const RUTA_DE_ERROR_POR_OMISION = "/ingreso";

/**
 * La librería respondió 5xx: algo interno falló. Su detalle ya quedó en el registro del servidor; este
 * error no lleva nada que pueda salir por la red (ADR-016) y quien atiende el pedido arma la respuesta
 * pública con su referencia.
 */
export class ErrorInternoDeIngreso extends Error {
  constructor(readonly estado: number) {
    super("falló el ingreso");
    this.name = "ErrorInternoDeIngreso";
  }
}

/** 404 neutro: mismo cuerpo vacío para todo lo que no se sirve, sin cookies. */
function respuestaNeutra(): Response {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
  });
}

/** Lo de la web de empresa (sin cambios): la lista cerrada de cuatro rutas, sin comprobar cuerpos acá (lo hace la ruta). */
const POLITICA_DE_EMPRESA: PoliticaDeAudiencia = {
  rutaPermitida,
  rechazarCuerpo: () => null,
  codigoDeRedireccion: codigoPublicoDeIngreso,
  estadoDeError: (estado) => estado,
  cuerpoDeError: (_estado, texto) => ({ codigo: codigoPublicoDeSolicitud(texto) }),
  async moldearExito(ruta, respuesta, cabeceras) {
    if (ruta === `${RUTA_BASE_DE_INGRESO}/get-session`) {
      // Sin el token de la sesión ni los datos del usuario en el cuerpo (ver `cuerpoPublicoDeSesion`).
      cabeceras.delete("content-length");
      cabeceras.set("Content-Type", "application/json");
      const cuerpo = cuerpoPublicoDeSesion(await respuesta.text());
      return new Response(JSON.stringify(cuerpo), { status: respuesta.status, headers: cabeceras });
    }
    if (ruta === `${RUTA_BASE_DE_INGRESO}/sign-in/social`) {
      // S1: lo único que sale es la dirección de Google. Si la librería devolviera una sesión (con su
      // `token` y el usuario) en el cuerpo, no llega al navegador: se corta con un error sin detalle.
      const cuerpo = cuerpoPublicoDeIngresoSocial(await respuesta.text());
      if (cuerpo === null) {
        throw new Error("el inicio del ingreso no devolvió una dirección https");
      }
      cabeceras.delete("content-length");
      cabeceras.set("Content-Type", "application/json");
      return new Response(JSON.stringify(cuerpo), { status: respuesta.status, headers: cabeceras });
    }
    return null;
  },
};

type NucleoDeAutenticacion = Readonly<{
  autenticacion: Autenticacion;
  instanciaDe: (host: string) => ReturnType<typeof betterAuth> | null;
  falloInterno: (error: unknown) => ErrorInternoDeIngreso;
  reloj: () => Date;
}>;

/**
 * La parte común de las dos audiencias: una INSTANCIA de la librería por host, en una caché acotada, y los dos
 * métodos del puerto. Lo que cambia entre audiencias entra por `politica` (qué rutas, qué cuerpos, qué sale) y por
 * `opcionesDeAudiencia` (las opciones de la librería).
 */
function crearNucleo(
  c: ConfiguracionDeAutenticacion,
  limites: LimitesDeSesion,
  politica: PoliticaDeAudiencia,
  opcionesDeAudiencia: (
    host: string,
    base: ReturnType<typeof configuracionDeHost> & { ok: true },
    reloj: () => Date,
    registrar: (detalle: string) => void,
    rutaDeError: string,
  ) => Parameters<typeof betterAuth>[0],
  conSegundoFactor: boolean,
): NucleoDeAutenticacion {
  const reloj = c.reloj ?? (() => new Date());
  const registrar = c.registrar ?? (() => undefined);
  const rutaDeError = c.rutaDeError ?? RUTA_DE_ERROR_POR_OMISION;
  const cache = crearCacheAcotada<ReturnType<typeof betterAuth>>(
    c.capacidadDeLaCache ?? CAPACIDAD_DE_LA_CACHE,
  );

  /**
   * Un fallo que no es de una sesión mala sino de la librería o de la base (la conexión, un esquema que no
   * coincide, un 5xx): el detalle va al registro del servidor y lo que sale es un error sin detalle. Sin
   * esto, el mensaje crudo de Postgres (con el nombre del rol, por ejemplo) viajaría hasta quien llama.
   */
  function falloInterno(error: unknown): ErrorInternoDeIngreso {
    if (error instanceof ErrorInternoDeIngreso) return error;
    const detalle = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    try {
      registrar(`[ingreso] fallo interno: ${detalle}`);
    } catch {
      // Un registro que falla no puede tapar el error.
    }
    return new ErrorInternoDeIngreso(500);
  }

  function crearInstancia(host: string) {
    const configuracion = configuracionDeHost(host);
    if (!configuracion.ok) throw new ErrorDeConfiguracion("el host de ingreso no es válido");
    return betterAuth(opcionesDeAudiencia(host, configuracion, reloj, registrar, rutaDeError));
  }

  /** La instancia del host, o `null` si el host no es un nombre de host válido. */
  function instanciaDe(host: string) {
    if (!configuracionDeHost(host).ok) return null;
    return cache.obtenerOCrear(host, () => crearInstancia(host));
  }

  const autenticacion: Autenticacion = {
    async sesionDe(pedido, host) {
      const instancia = instanciaDe(host);
      if (instancia === null) return null;
      let leida;
      try {
        leida = await instancia.api.getSession({ headers: pedido.headers, returnHeaders: true });
      } catch (error) {
        // Una sesión que no vale (otro host, vencida, borrada) llega como 401: es «no hay sesión».
        // Cualquier otra cosa (la base caída, un 5xx) es un fallo y se propaga.
        if (isAPIError(error) && error.statusCode === 401) return null;
        throw falloInterno(error);
      }
      const datos = leida.response;
      if (datos === null) return null;
      const { session, user } = datos;
      // Se vuelve a decidir con la misma función pura: la barrera no depende de que el gancho de la
      // librería haya corrido (si alguien lo quita, esta línea sigue cerrando el paso).
      const vigencia = vigenciaDeSesion(
        {
          host: hostGuardado(session),
          creadaEn: session.createdAt,
          ultimoUso: session.updatedAt,
          venceEn: session.expiresAt,
        },
        host,
        reloj(),
        limites,
      );
      if (vigencia !== "VIGENTE" || user.emailVerified !== true) return null;
      return {
        usuarioAuth: usuarioAuthId(user.id),
        email: user.email,
        emailVerificado: true,
        creadaEn: session.createdAt,
        ultimoUso: session.updatedAt,
        venceEn: session.expiresAt,
        ...(conSegundoFactor ? { segundoFactorEn: segundoFactorEnDe(session) } : {}),
        cookiesDeRespuesta: leida.headers.getSetCookie(),
      };
    },

    async manejar(pedido, host) {
      const origen = new URL(pedido.url);
      if (!politica.rutaPermitida(pedido.method, origen.pathname)) return respuestaNeutra();
      const configuracion = configuracionDeHost(host);
      const instancia = instanciaDe(host);
      if (!configuracion.ok || instancia === null) return respuestaNeutra();

      // El pedido se rearma sobre el origen FIJO de la instancia: lo que la librería ve no depende de
      // cómo el servidor haya armado `pedido.url` (de eso no hay garantía; del `host` de la puerta, sí).
      const baseURL = configuracion.valor.baseURL;
      const sinCuerpo = pedido.method === "GET" || pedido.method === "HEAD";
      const cuerpo = sinCuerpo ? null : await pedido.arrayBuffer();
      if (cuerpo !== null) {
        const rechazo = politica.rechazarCuerpo(
          pedido.method,
          origen.pathname,
          new TextDecoder().decode(cuerpo),
        );
        if (rechazo !== null) return rechazo;
      }
      const copia = new Request(`${baseURL}${origen.pathname}${origen.search}`, {
        method: pedido.method,
        headers: pedido.headers,
        ...(cuerpo === null ? {} : { body: cuerpo }),
        redirect: "manual",
      });
      let respuesta: Response;
      try {
        respuesta = await instancia.handler(copia);
      } catch (error) {
        throw falloInterno(error);
      }
      if (respuesta.status >= 500)
        throw falloInterno(new Error(`la librería respondió ${respuesta.status}`));
      const cabeceras = new Headers(respuesta.headers);
      if (!cabeceras.has("cache-control")) cabeceras.set("Cache-Control", "private, no-store");

      if (respuesta.status >= 300 && respuesta.status < 400) {
        const ubicacion = cabeceras.get("location");
        if (ubicacion !== null)
          cabeceras.set(
            "location",
            sanearUbicacionDeError(ubicacion, baseURL, politica.codigoDeRedireccion),
          );
        return new Response(null, { status: respuesta.status, headers: cabeceras });
      }
      if (respuesta.status >= 400) {
        // Un error de la librería sale con su código y nada más: ni su mensaje ni ningún otro campo.
        const esJson = (cabeceras.get("content-type") ?? "").includes("json");
        cabeceras.delete("content-length");
        cabeceras.delete("content-type");
        if (!esJson) return new Response(null, { status: respuesta.status, headers: cabeceras });
        cabeceras.set("Content-Type", "application/json");
        const cuerpoDeError = politica.cuerpoDeError(
          respuesta.status,
          await respuesta.text(),
          cabeceras,
        );
        return new Response(JSON.stringify(cuerpoDeError), {
          status: politica.estadoDeError(respuesta.status),
          headers: cabeceras,
        });
      }
      let moldeada: Response | null;
      try {
        moldeada = await politica.moldearExito(origen.pathname, respuesta, cabeceras);
      } catch (error) {
        throw falloInterno(error);
      }
      return (
        moldeada ?? new Response(respuesta.body, { status: respuesta.status, headers: cabeceras })
      );
    },
  };

  return { autenticacion, instanciaDe, falloInterno, reloj };
}

export function crearAutenticacionDeBetterAuth(c: ConfiguracionDeAutenticacion): Autenticacion {
  const limites = c.limites ?? LIMITES_DE_SESION;
  return crearNucleo(
    c,
    limites,
    POLITICA_DE_EMPRESA,
    (_host, configuracion, reloj, registrar, rutaDeError) =>
      opcionesDeInstancia({
        configuracion: configuracion.valor,
        db: c.db,
        secreto: c.secreto,
        google: c.google,
        limites,
        reloj,
        ...(c.encabezadoDeIp === undefined ? {} : { encabezadoDeIp: c.encabezadoDeIp }),
        rutaDeError,
        registrar,
      }),
    false,
  ).autenticacion;
}

/**
 * La autenticación de la consola de plataforma (h5-p8): el mismo núcleo con `twoFactor`, los límites de plataforma
 * (8 horas / 30 minutos), cookies `__Host-zh_plat.*`, la lista cerrada de rutas de plataforma y respuestas propias.
 */
export function crearAutenticacionDePlataformaDeBetterAuth(
  c: ConfiguracionDeAutenticacionDePlataforma,
): AutenticacionDePlataforma {
  const limites = c.limites ?? LIMITES_DE_SESION_DE_PLATAFORMA;
  const reloj = c.reloj ?? (() => new Date());
  const nucleo = crearNucleo(
    c,
    limites,
    politicaDePlataforma({ reloj, limites }),
    (_host, configuracion, relojDeLaInstancia, registrar, rutaDeError) =>
      opcionesDeInstancia({
        audiencia: "PLATAFORMA",
        consola: c.consola,
        configuracion: configuracion.valor,
        db: c.db,
        secreto: c.secreto,
        google: c.google,
        limites,
        reloj: relojDeLaInstancia,
        ...(c.encabezadoDeIp === undefined ? {} : { encabezadoDeIp: c.encabezadoDeIp }),
        rutaDeError,
        registrar,
      }),
    true,
  );
  return {
    ...nucleo.autenticacion,
    async estadoDeSesion(pedido, host) {
      const instancia = nucleo.instanciaDe(host);
      if (instancia === null) return SIN_SESION_DE_PLATAFORMA;
      const api = instancia.api as unknown as Record<
        string,
        (entrada: { headers: Headers }) => Promise<EstadoDeSesionDePlataforma>
      >;
      try {
        return await (api["estadoDeSesionDePlataforma"] as NonNullable<(typeof api)[string]>)({
          headers: pedido.headers,
        });
      } catch (error) {
        throw nucleo.falloInterno(error);
      }
    },
  };
}
