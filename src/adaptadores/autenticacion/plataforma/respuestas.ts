import {
  codigoPublicoDeErrorDePlataforma,
  codigoPublicoDeIngresoDePlataforma,
} from "../../../capacidades/autenticacion/codigos-de-plataforma";
import { codigoPublicoDeSolicitud } from "../../../capacidades/autenticacion/codigos-de-ingreso";
import { cuerpoPublicoDeSesionDePlataforma } from "../../../capacidades/autenticacion/cuerpo-de-sesion-de-plataforma";
import {
  altaDeSegundoFactorDeLaLibreria,
  codigosDeRecuperacionDeLaLibreria,
  cuerpoDeCodigoDeRecuperacionValido,
  cuerpoDeCodigoDeTotpValido,
  cuerpoVacioValido,
} from "../../../capacidades/autenticacion/cuerpos-de-segundo-factor";
import { RUTA_BASE_DE_INGRESO } from "../../../capacidades/autenticacion/host-de-autenticacion";
import { cuerpoDeIngresoSocialValido } from "../../../capacidades/autenticacion/ingreso-social";
import { rutaPermitidaDePlataforma } from "../../../capacidades/autenticacion/rutas-permitidas";
import { segundoFactorRecienteHastaMs } from "../../../capacidades/autenticacion/ventanas-de-segundo-factor";
import {
  LIMITES_DE_SESION_DE_PLATAFORMA,
  type LimitesDeSesion,
} from "../../../capacidades/autenticacion/vigencia-de-sesion";
import { esObjeto, leerJson } from "../../../capacidades/autenticacion/json-seguro";
import { qrComoSvg } from "./qr-svg";

/**
 * Cómo se ve la consola de plataforma desde afuera (h5-p8 §3): qué cuerpos acepta cada ruta, qué devuelve cada una
 * y cómo salen los errores. Lo que la librería devuelve nunca sale tal cual: de cada respuesta se extrae lo que la
 * pantalla necesita y nada más (ni el `token` de la sesión, ni el usuario, ni mensajes de la librería).
 */

export const RUTA = {
  ingresoSocial: `${RUTA_BASE_DE_INGRESO}/sign-in/social`,
  sesion: `${RUTA_BASE_DE_INGRESO}/get-session`,
  enrolar: `${RUTA_BASE_DE_INGRESO}/two-factor/enable`,
  totp: `${RUTA_BASE_DE_INGRESO}/two-factor/verify-totp`,
  recuperacion: `${RUTA_BASE_DE_INGRESO}/two-factor/verify-backup-code`,
  regenerar: `${RUTA_BASE_DE_INGRESO}/two-factor/generate-backup-codes`,
} as const;

const RUTAS_MOLDEADAS: readonly string[] = [
  RUTA.sesion,
  RUTA.enrolar,
  RUTA.regenerar,
  RUTA.totp,
  RUTA.recuperacion,
];

const SIN_CACHE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

function json(cuerpo: unknown, estado: number, cabeceras: Headers): Response {
  cabeceras.delete("content-length");
  cabeceras.set("Content-Type", "application/json");
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: cabeceras });
}

/** Una respuesta con un secreto (el alta del segundo factor, códigos nuevos): `no-store` y nada que la guarde. */
function sinGuardar(cabeceras: Headers): Headers {
  cabeceras.set("Cache-Control", "no-store");
  cabeceras.set("Pragma", "no-cache");
  return cabeceras;
}

export type PoliticaDeAudiencia = Readonly<{
  rutaPermitida: (metodo: string, ruta: string) => boolean;
  /** `null` si el cuerpo vale; si no, la respuesta que lo rechaza (antes de tocar la librería). */
  rechazarCuerpo: (metodo: string, ruta: string, cuerpo: string) => Response | null;
  codigoDeRedireccion: (codigo: string | null) => string;
  /** El estado HTTP con que sale un error de la librería (la web de empresa lo deja como viene). */
  estadoDeError: (estadoDeLaLibreria: number) => number;
  /** El cuerpo público de un error de la librería (4xx). */
  cuerpoDeError: (estado: number, textoDeLaLibreria: string, cabeceras: Headers) => unknown;
  /** Reemplaza una respuesta EXITOSA de la librería por la pública, o `null` si esa ruta sale como viene. */
  moldearExito: (ruta: string, respuesta: Response, cabeceras: Headers) => Promise<Response | null>;
}>;

function rechazo(codigo: string, estado: number): Response {
  return new Response(JSON.stringify({ codigo }), {
    status: estado,
    headers: { ...SIN_CACHE, "Content-Type": "application/json" },
  });
}

/** Segundos que la librería pide esperar (`X-Retry-After`), en milisegundos; `null` si no vienen. */
function esperaDeLaLibreria(cabeceras: Headers): number | null {
  const segundos = Number(cabeceras.get("x-retry-after"));
  return Number.isFinite(segundos) && segundos > 0 ? Math.ceil(segundos) * 1000 : null;
}

export function politicaDePlataforma(d: {
  reloj: () => Date;
  limites?: LimitesDeSesion;
}): PoliticaDeAudiencia {
  const limites = d.limites ?? LIMITES_DE_SESION_DE_PLATAFORMA;
  return {
    rutaPermitida: rutaPermitidaDePlataforma,
    rechazarCuerpo(metodo, ruta, cuerpo) {
      if (metodo !== "POST") return null;
      if (ruta === RUTA.ingresoSocial) {
        return cuerpoDeIngresoSocialValido(cuerpo) ? null : rechazo("no_habilitado", 400);
      }
      if (ruta === RUTA.totp) {
        return cuerpoDeCodigoDeTotpValido(cuerpo) ? null : rechazo("codigo_invalido", 400);
      }
      if (ruta === RUTA.recuperacion) {
        return cuerpoDeCodigoDeRecuperacionValido(cuerpo) ? null : rechazo("codigo_invalido", 400);
      }
      if (ruta === RUTA.enrolar || ruta === RUTA.regenerar) {
        return cuerpoVacioValido(cuerpo) ? null : rechazo("no_habilitado", 400);
      }
      return null;
    },
    codigoDeRedireccion: codigoPublicoDeIngresoDePlataforma,
    // Dos pedidos a la vez con el mismo código de recuperación: la librería le da 409 al que llega segundo. Para quien
    // llama es lo mismo que un código inválido (401), sin pistas de cuál de los dos ganó.
    estadoDeError: (estado) => (estado === 409 ? 401 : estado),
    cuerpoDeError(estado, texto, cabeceras) {
      const codigo = codigoPublicoDeErrorDePlataforma(estado, codigoPublicoDeSolicitud(texto));
      if (codigo !== "demasiados_intentos") return { codigo };
      // Cuándo reintentar: lo dice el bloqueo propio (en el cuerpo) o, si fue el límite de pedidos de la librería, su encabezado.
      const datos = leerJson(texto);
      const propio = esObjeto(datos) && "reintentarEnMs" in datos ? datos.reintentarEnMs : null;
      const reintentarEnMs =
        Number.isFinite(propio) && (propio as number) >= 0
          ? Math.ceil(propio as number)
          : esperaDeLaLibreria(cabeceras);
      if (reintentarEnMs !== null)
        cabeceras.set("Retry-After", String(Math.ceil(reintentarEnMs / 1000)));
      return reintentarEnMs === null ? { codigo } : { codigo, reintentarEnMs };
    },
    async moldearExito(ruta, respuesta, cabeceras) {
      // Las rutas que no se moldean salen como vienen, con el cuerpo sin leer.
      if (!RUTAS_MOLDEADAS.includes(ruta)) return null;
      const texto = await respuesta.text();
      if (ruta === RUTA.sesion) {
        return json(
          cuerpoPublicoDeSesionDePlataforma(texto, d.reloj(), limites),
          respuesta.status,
          cabeceras,
        );
      }
      if (ruta === RUTA.enrolar) {
        const alta = altaDeSegundoFactorDeLaLibreria(texto);
        if (alta === null) throw new Error("el alta del segundo factor no tiene la forma esperada");
        return json(
          {
            qrSvg: qrComoSvg(alta.direccion),
            secreto: alta.secreto,
            codigosDeRecuperacion: alta.codigos,
          },
          respuesta.status,
          sinGuardar(cabeceras),
        );
      }
      if (ruta === RUTA.regenerar) {
        const codigos = codigosDeRecuperacionDeLaLibreria(texto);
        if (codigos === null) throw new Error("los códigos nuevos no tienen la forma esperada");
        return json({ codigosDeRecuperacion: codigos }, respuesta.status, sinGuardar(cabeceras));
      }
      // Las dos que quedan en RUTAS_MOLDEADAS: verificar el código de la aplicación o uno de recuperación.
      const ahora = d.reloj();
      // Recién verificado: la ventana de «reciente» está entera (la misma cuenta que usa el estado de sesión).
      return json(
        {
          verificado: true,
          segundoFactorRecienteHastaMs: segundoFactorRecienteHastaMs(ahora, ahora),
        },
        respuesta.status,
        cabeceras,
      );
    },
  };
}
