import { randomBytes } from "node:crypto";
import { textoDeExcepcionSegura } from "../adaptadores/trabajos/error-seguro";
import type { ProcesadorDeTrabajos } from "../adaptadores/trabajos/procesador";
import { referenciaDeError } from "../plataforma/dominio/referencia";
import type { BarridoDeAutenticacion } from "../puertos/autenticacion";
import { autorizadoPorElCron } from "./autorizacion-de-cron";

/**
 * Las dos rutas de sistema de la web (web-armazon §5.2, §5.5 y §8.1 W6): `/api/trabajos/cron` y `/api/salud`.
 * Viven acá, y no en la carpeta de la ruta, para probarse sin levantar Next: la ruta solo les pasa el pedido y
 * las dependencias. La puerta (`proxy.ts`) las deja pasar en CUALQUIER host (lista cerrada,
 * `RUTAS_DE_SISTEMA`), así que cada una se defiende sola.
 *
 * Toda respuesta: `Cache-Control: private, no-store`, `X-Robots-Tag: noindex` y ninguna cookie. Ningún error
 * interno sale con detalle (ADR-016): el detalle va al registro del servidor; quien llamó recibe un código y
 * una referencia `ZH-…`.
 *
 * COSTURA CON W5: el traductor de errores común (`aRespuesta`, ADR-016) lo crea W5 en paralelo. Hasta que
 * aterrice, `respuestaDeFallaInterna` hace de traductor mínimo (el mismo contrato que `ruta-de-ingreso.ts`:
 * código estable + referencia); cuando exista `aRespuesta` se reemplaza esta función por él.
 */

const SIN_CACHE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } as const;
const JSON_SIN_CACHE = { ...SIN_CACHE, "Content-Type": "application/json" } as const;

/** Cuántos trabajos como máximo procesa cada llamada del cron (la cola es un respaldo del despacho inmediato). */
export const LIMITE_DE_TRABAJOS_POR_PASADA = 50;

type AzarDeReferencia = () => Uint8Array;

function respuestaDeFallaInterna(
  detalle: string,
  registrar: (detalle: string) => void,
  azar: AzarDeReferencia,
): Response {
  const referencia = referenciaDeError(azar());
  try {
    registrar(`${referencia} ${detalle}`);
  } catch {
    // Un registro que falla no puede tapar la respuesta.
  }
  return new Response(JSON.stringify({ codigo: "ERROR_INTERNO", referencia }), {
    status: 500,
    headers: JSON_SIN_CACHE,
  });
}

// ---------------------------------------------------------------------------------------------------------
// Cron de trabajos
// ---------------------------------------------------------------------------------------------------------

export type DependenciasDelCron = Readonly<{
  /** El valor de `CRON_SECRET`. Lanza si falta o no sirve (el cron falla cerrado). */
  secreto: () => string;
  procesador: () => ProcesadorDeTrabajos;
  barrido: () => BarridoDeAutenticacion;
  ahora: () => Date;
  /** Registro del servidor: recibe el detalle de un fallo. Nunca sale en una respuesta ni lleva datos personales. */
  registrar: (detalle: string) => void;
  /** Solo para las pruebas: el azar de la referencia. */
  azar?: AzarDeReferencia;
}>;

/** 401 sin cuerpo y sin pista de por qué: sin secreto, con otro, o con el servidor mal configurado. */
function sinAutorizar(): Response {
  return new Response(null, { status: 401, headers: SIN_CACHE });
}

/**
 * Qué hace el cron de Vercel (una vez por día mientras sea Hobby). Autorizado con `CRON_SECRET`:
 *  1. El despacho de la cola de trabajos: toma y ejecuta los pendientes o vencidos (reintentos incluidos).
 *     Dos llamadas a la vez no duplican nada: el procesador toma cada trabajo con un `UPDATE` condicionado,
 *     y quien pierde la carrera no ejecuta (ADR-007).
 *  2. El barrido de sesiones, verificaciones y contadores de pedidos vencidos de la autenticación (W3b).
 * `ahora` se toma UNA vez y sirve para las dos tareas. Una tarea que falla no impide la otra; si alguna falló,
 * la respuesta es 500 con referencia (así el registro del cron de Vercel lo muestra) y el detalle queda en el
 * registro del servidor. Es idempotente: repetirlo no hace nada de más.
 */
export async function atenderCron(
  pedido: Request,
  dependencias: DependenciasDelCron,
): Promise<Response> {
  const azar = dependencias.azar ?? (() => randomBytes(4));
  let secreto: string;
  try {
    secreto = dependencias.secreto();
  } catch (error) {
    // Servidor mal configurado: al que llama se le dice lo mismo que a cualquiera (sin oráculo), y el dueño lo
    // ve en el registro. Los nombres de las variables que faltan los registra la composición, nunca los valores.
    const detalle = error instanceof Error ? error.name : "falla que no es un Error";
    try {
      dependencias.registrar(`[cron] sin secreto utilizable (${detalle})`);
    } catch {
      // Un registro que falla no cambia la respuesta.
    }
    return sinAutorizar();
  }
  if (!autorizadoPorElCron(pedido.headers.get("authorization"), secreto)) return sinAutorizar();

  const ahora = dependencias.ahora();
  const fallas: string[] = [];
  const tarea = async <T>(nombre: string, trabajo: () => Promise<T>): Promise<T | null> => {
    try {
      return await trabajo();
    } catch (error) {
      fallas.push(`${nombre}: ${textoDeExcepcionSegura(error)}`);
      return null;
    }
  };
  const [despacho, barrido] = await Promise.all([
    tarea("despacho", () =>
      dependencias
        .procesador()
        .procesarPendientes({ ahora, limite: LIMITE_DE_TRABAJOS_POR_PASADA }),
    ),
    tarea("barrido", () => dependencias.barrido().barrerVencidos(ahora)),
  ]);
  if (fallas.length > 0) {
    return respuestaDeFallaInterna(`[cron] ${fallas.join(" | ")}`, dependencias.registrar, azar);
  }
  return new Response(JSON.stringify({ ok: true, despacho, barrido }), {
    status: 200,
    headers: JSON_SIN_CACHE,
  });
}

// ---------------------------------------------------------------------------------------------------------
// Salud
// ---------------------------------------------------------------------------------------------------------

export type DependenciasDeLaSalud = Readonly<{
  /** `true` si la base responde. No lanza (si lanzara, es «no ok»). */
  baseResponde: () => Promise<boolean>;
}>;

/**
 * `/api/salud`: ¿responde la base con el rol limitado de la aplicación? Pública y sin datos: `{"ok":true}` con
 * 200, o `{"ok":false}` con 503, y nada más (ni el motivo, ni nombres, ni versiones, ni referencia). Falla
 * cerrado: ante cualquier duda, «no ok». El detalle de por qué falla lo registra quien arma `baseResponde`.
 */
export async function atenderSalud(dependencias: DependenciasDeLaSalud): Promise<Response> {
  let ok: boolean;
  try {
    ok = (await dependencias.baseResponde()) === true;
  } catch {
    ok = false;
  }
  return new Response(JSON.stringify({ ok }), {
    status: ok ? 200 : 503,
    headers: JSON_SIN_CACHE,
  });
}
