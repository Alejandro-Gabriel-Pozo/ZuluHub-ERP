import { CODIGO_DE_SOLICITUD_GENERICO } from "../capacidades/autenticacion/codigos-de-ingreso";
import { RUTA_BASE_DE_INGRESO } from "../capacidades/autenticacion/host-de-autenticacion";
import { cuerpoDeIngresoSocialValido } from "../capacidades/autenticacion/ingreso-social";
import { estadoHttpDe } from "../capacidades/experiencia/respuesta";
import { respuestaDeFalla as falloSinDetalle } from "./a-respuesta";
import { ErrorDeEntorno } from "./entorno";
import type { Autenticacion } from "../puertos/autenticacion";
import type { ResolucionDeHost } from "../puertos/marcas";

/**
 * Qué hace `app/api/auth/[...todo]` con un pedido (web-armazon §3.1, G8 y ADR-016). Vive acá, y no en la
 * carpeta de la ruta, para probarse sin levantar Next: la ruta solo le pasa el pedido.
 *
 *  1. El host sale de la cabecera `host` (nunca del encabezado de host reenviado, que el cliente puede inventar) y se
 *     resuelve contra la puerta pública para la superficie APP (G8): en un host que no es de una aplicación
 *     (landing, carta, desconocido, retirado) la respuesta es el 404 NEUTRO de siempre, sin cuerpo ni
 *     cookies. Es la misma respuesta para todo lo que no se sirve (sin oráculo).
 *  2. Si el host es de una aplicación, atiende la autenticación DE ESE HOST (`host` normalizado).
 *  3. `POST sign-in/social` (empezar el ingreso con Google) solo acepta `provider` y `callbackURL` (S1): un
 *     `idToken` o `accessToken` mandado directo se rechaza con 400 antes de llegar a la librería, que con
 *     ellos abriría una sesión sin pasar por Google. Es la segunda barrera: la primera es
 *     `disableIdTokenSignIn` en la configuración de la librería.
 *  4. Un fallo no sale con detalle (ADR-016): el traductor único (`a-respuesta.ts`) manda el detalle al
 *     registro del servidor y el pedido recibe un error genérico con una referencia `ZH-…` para que soporte
 *     la busque. Una base que no responde al
 *     resolver el host es 503, nunca el 404 neutro ni la marca principal.
 *
 * COSTURA CON W4: la resolución del host se repite en cada pedido (la caché de hasta 60 s y la puerta
 * `servidor/puerta.ts` son de W4). Cuando exista, esta función recibe su resultado en lugar de resolver.
 */

export type DependenciasDeLaRuta = Readonly<{
  resolucionDeHost: () => ResolucionDeHost;
  autenticacion: () => Autenticacion;
  /** Registro del servidor: recibe el detalle de un fallo. Nunca sale en una respuesta. */
  registrar: (detalle: string) => void;
  /** Solo para las pruebas: el azar de la referencia. */
  azar?: () => Uint8Array;
}>;

const SIN_CACHE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

/** 404 neutro: igual para todo lo que no se sirve; sin cuerpo y sin cookies. */
export function respuestaNeutra(): Response {
  return new Response(null, { status: 404, headers: SIN_CACHE });
}

function respuestaDeFalla(
  estado: 500 | 503,
  detalle: string,
  dependencias: DependenciasDeLaRuta,
): Response {
  // El traductor único (ADR-016) arma la referencia, registra el detalle y decide el código público.
  const error = falloSinDetalle(detalle, dependencias, estado === 503);
  return new Response(JSON.stringify({ codigo: error.codigo, referencia: error.referencia }), {
    status: estadoHttpDe(error.codigo),
    headers: { ...SIN_CACHE, "Content-Type": "application/json" },
  });
}

const RUTA_DE_INGRESO_SOCIAL = `${RUTA_BASE_DE_INGRESO}/sign-in/social`;

function solicitudInvalida(): Response {
  return new Response(JSON.stringify({ codigo: CODIGO_DE_SOLICITUD_GENERICO }), {
    status: 400,
    headers: { ...SIN_CACHE, "Content-Type": "application/json" },
  });
}

export async function atenderRutaDeIngreso(
  pedido: Request,
  dependencias: DependenciasDeLaRuta,
): Promise<Response> {
  try {
    const resolucion = await dependencias
      .resolucionDeHost()
      .porHost(pedido.headers.get("host") ?? "", "APP");
    if (!resolucion.ok) {
      return respuestaDeFalla(
        503,
        `no se pudo resolver el host: ${resolucion.error.tipo}`,
        dependencias,
      );
    }
    if (resolucion.valor === null) return respuestaNeutra();
    if (pedido.method === "POST" && new URL(pedido.url).pathname === RUTA_DE_INGRESO_SOCIAL) {
      // `clone`: la librería lee el cuerpo después, y un cuerpo solo se lee una vez.
      if (!cuerpoDeIngresoSocialValido(await pedido.clone().text())) return solicitudInvalida();
    }
    return await dependencias.autenticacion().manejar(pedido, resolucion.valor.host);
  } catch (error) {
    // El detalle de un fallo de entorno ya lo registró la composición (con los NOMBRES, nunca los valores).
    const detalle =
      error instanceof ErrorDeEntorno
        ? "el entorno no está bien configurado"
        : error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
    return respuestaDeFalla(500, detalle, dependencias);
  }
}
