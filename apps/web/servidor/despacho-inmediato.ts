import "server-only";

import { after } from "next/server";
import type { EmpresaId } from "../../../src/primitivas/identificadores/marca";
import { claveDeEnvioDeInvitacion } from "../../../src/modulos/identidad/publico";
import { trabajos } from "./composicion";

/**
 * El despacho inmediato de ADR-007: después de que la transacción que encoló los trabajos se CONFIRMÓ, la misma
 * solicitud intenta ejecutarlos sin hacer esperar a la persona. Lo usan las acciones del servidor que encolan
 * (`despacharDespuesDeConfirmar(ids)` justo tras el `ejecutar` exitoso, nunca dentro de la transacción).
 *
 *  - `after()` de Next corre DESPUÉS de enviar la respuesta: nada de esto demora ni puede hacer fallar lo que ve
 *    la persona. Es una optimización de latencia, no una garantía: si el proceso muere o el intento falla, el
 *    trabajo sigue `PENDIENTE` y el cron lo levanta (misma toma condicionada, no se ejecuta dos veces).
 *  - `despacharAhora` no lanza; lo único que puede fallar acá es armar el procesador (entorno), y eso se registra por
 *    su tipo, sin mensaje, y no sale. Acá SÍ espera a que termine todo (`esperarHastaTerminar`): el tope de 5 s es
 *    para quien hace esperar a una persona, y `after()` no la hace esperar; si la función se cerrara a los 5 s, una
 *    autorización de ARCA (hasta 25 s) quedaría cortada con la serie reservada. Lo acota el `maxDuration` de la ruta
 *    que aloja la acción (ver PRIMER-DESPLIEGUE.md) y, por debajo, los tiempos propios de cada llamada a ARCA.
 *  - Sin ids no se programa nada. El reloj se toma al correr, no al encolar.
 */
export function despacharDespuesDeConfirmar(ids: readonly string[]): void {
  if (ids.length === 0) return;
  after(async () => {
    try {
      await trabajos.procesador().despacharAhora(ids, new Date(), { esperarHastaTerminar: true });
    } catch (error) {
      console.error(
        `[despacho] no se pudo despachar de inmediato (${error instanceof Error ? error.name : "falla que no es un Error"}); queda para el cron`,
      );
    }
  });
}

/**
 * Lo mismo para quien encoló por CLAVE de idempotencia y no conoce el id del trabajo (encolar no lo devuelve): después
 * de confirmar, busca los trabajos DE ESA EMPRESA con esas claves y los intenta. Así una factura recién emitida sale a
 * ARCA sin esperar al cron. Mejor esfuerzo, igual que arriba: si algo falla queda registrado por su tipo y el trabajo
 * sigue `PENDIENTE` para el cron. Sin claves no se programa nada.
 */
export function despacharPorClavesDespuesDeConfirmar(
  empresaId: EmpresaId,
  claves: readonly string[],
): void {
  if (claves.length === 0) return;
  after(async () => {
    try {
      await trabajos
        .procesador()
        .despacharPorClaves(empresaId, claves, new Date(), { esperarHastaTerminar: true });
    } catch (error) {
      console.error(
        `[despacho] no se pudo despachar de inmediato (${error instanceof Error ? error.name : "falla que no es un Error"}); queda para el cron`,
      );
    }
  });
}

/**
 * El mail de una invitación recién creada (`enviar_invitacion`, clave `invitacion:<id>:envio`): sale en segundos y no cuando pase el cron. Va DESPUÉS de confirmada la transacción que
 * creó la invitación y encoló el trabajo (quien llama ya recibió su resultado) y es mejor esfuerzo, igual que el resto: si falla, la acción de la persona no falla, queda registrado por su
 * tipo y el trabajo sigue `PENDIENTE` para el cron. Despachar dos veces, o a la vez que el cron, no manda dos mails: la toma del trabajo es condicionada y el envío lleva su clave de
 * idempotencia. Previene: que una invitación (y el alta de un empleado nuevo) espere al cron, que de noche corre cada 2 horas. Chequeo: `test/web/despacho.test.ts` y
 * `test/integracion/trabajos-envio-invitacion.test.ts` (despacho inmediato por clave).
 */
export function despacharElEnvioDeUnaInvitacion(empresaId: EmpresaId, invitacionId: string): void {
  despacharPorClavesDespuesDeConfirmar(empresaId, [claveDeEnvioDeInvitacion(invitacionId)]);
}
