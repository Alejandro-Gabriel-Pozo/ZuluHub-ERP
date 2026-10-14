import "server-only";

import { atenderRutaDeIngreso } from "../../../src/composicion/ruta-de-ingreso";
import { web } from "./composicion";

/**
 * Atiende `/api/auth/*` (web-armazon §3.1): ingreso con Google, retorno, lectura de la sesión y cierre.
 * No decide nada: le pasa el pedido a la composición, que resuelve el host (solo los hosts APP sirven
 * esto, G8), atiende con la autenticación de ese host y traduce cualquier fallo a una respuesta sin
 * detalle (ADR-016). El registro del servidor es la salida de errores de la función.
 */
export function atenderIngreso(pedido: Request): Promise<Response> {
  return atenderRutaDeIngreso(pedido, {
    resolucionDeHost: web.resolucionDeHost,
    autenticacion: web.autenticacion,
    registrar: (detalle) => {
      console.error(`[ingreso] ${detalle}`);
    },
  });
}
