import "server-only";

import { detalleDeFalla, estadoHttpDe } from "../../../src/capacidades/experiencia/respuesta";
import { respuestaDeFalla } from "../../../src/composicion/a-respuesta";
import { consola } from "./consola";

const SIN_CACHE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

/**
 * Atiende `/api/auth/*` de la consola: ingreso con Google, retorno, estado de la sesión, segundo factor y cierre.
 * Pasa SIEMPRE el host de la consola ya validado (`hostDeLaConsola()`), nunca el encabezado `Host` del pedido: una
 * ruta con otro host responde el 404 neutro. Un fallo (variable de entorno que falta, base caída) no sale con
 * detalle (ADR-016): el detalle va al registro del servidor y el pedido recibe un código y una referencia `PD-…`.
 */
export async function atenderIngreso(pedido: Request): Promise<Response> {
  try {
    return await consola.autenticacion().manejar(pedido, consola.hostDeLaConsola());
  } catch (excepcion) {
    const error = respuestaDeFalla(detalleDeFalla(excepcion), {
      registrar: (detalle) => {
        console.error(`[ingreso] ${detalle}`);
      },
    });
    return new Response(JSON.stringify({ codigo: error.codigo, referencia: error.referencia }), {
      status: estadoHttpDe(error.codigo),
      headers: { ...SIN_CACHE, "Content-Type": "application/json" },
    });
  }
}
