import "server-only";

import { after } from "next/server";
import { trabajos } from "./composicion";

/**
 * El despacho inmediato de ADR-007: después de que la transacción que encoló los trabajos se CONFIRMÓ, la misma
 * solicitud intenta ejecutarlos sin hacer esperar a la persona. Lo usan las acciones del servidor que encolan
 * (`despacharDespuesDeConfirmar(ids)` justo tras el `ejecutar` exitoso, nunca dentro de la transacción).
 *
 *  - `after()` de Next corre DESPUÉS de enviar la respuesta: nada de esto demora ni puede hacer fallar lo que ve
 *    la persona. Es una optimización de latencia, no una garantía: si el proceso muere o el intento falla, el
 *    trabajo sigue `PENDIENTE` y el cron lo levanta (misma toma condicionada, no se ejecuta dos veces).
 *  - `despacharAhora` no lanza ni espera más de su tope; lo único que puede fallar acá es armar el procesador
 *    (entorno), y eso se registra por su tipo, sin mensaje, y no sale.
 *  - Sin ids no se programa nada. El reloj se toma al correr, no al encolar.
 */
export function despacharDespuesDeConfirmar(ids: readonly string[]): void {
  if (ids.length === 0) return;
  after(async () => {
    try {
      await trabajos.procesador().despacharAhora(ids, new Date());
    } catch (error) {
      console.error(
        `[despacho] no se pudo despachar de inmediato (${error instanceof Error ? error.name : "falla que no es un Error"}); queda para el cron`,
      );
    }
  });
}
