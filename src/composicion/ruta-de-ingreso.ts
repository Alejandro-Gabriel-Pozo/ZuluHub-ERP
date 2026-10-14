import { randomBytes } from "node:crypto";
import { ErrorDeEntorno } from "./entorno";
import { referenciaDeError } from "../plataforma/dominio/referencia";
import type { Autenticacion } from "../puertos/autenticacion";
import type { ResolucionDeHost } from "../puertos/marcas";

/**
 * Qué hace `app/api/auth/[...todo]` con un pedido (web-armazon §3.1, G8 y ADR-016). Vive acá, y no en la
 * carpeta de la ruta, para probarse sin levantar Next: la ruta solo le pasa el pedido.
 *
 *  1. El host sale de la cabecera `host` (nunca de `X-Forwarded-Host`, que el cliente puede inventar) y se
 *     resuelve contra la puerta pública para la superficie APP (G8): en un host que no es de una aplicación
 *     (landing, carta, desconocido, retirado) la respuesta es el 404 NEUTRO de siempre, sin cuerpo ni
 *     cookies. Es la misma respuesta para todo lo que no se sirve (sin oráculo).
 *  2. Si el host es de una aplicación, atiende la autenticación DE ESE HOST (`host` normalizado).
 *  3. Un fallo no sale con detalle (ADR-016): el detalle va al registro del servidor y el pedido recibe un
 *     error genérico con una referencia `ZH-…` para que soporte la busque. Una base que no responde al
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
  const referencia = referenciaDeError((dependencias.azar ?? (() => randomBytes(4)))());
  try {
    dependencias.registrar(`${referencia} ${detalle}`);
  } catch {
    // Un registro que falla no puede tapar la respuesta.
  }
  return new Response(
    JSON.stringify({ codigo: estado === 503 ? "NO_DISPONIBLE" : "ERROR_INTERNO", referencia }),
    { status: estado, headers: { ...SIN_CACHE, "Content-Type": "application/json" } },
  );
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
