import "server-only";

import { atenderCron, atenderSalud } from "../../../src/composicion/rutas-de-sistema";
import { sistema, trabajos, web } from "./composicion";

/**
 * Las rutas de sistema vistas desde la aplicación (web-armazon §8.1 W6): `app/api/trabajos/cron` y
 * `app/api/salud` solo llaman a estas dos funciones, que juntan las dependencias reales. Lo que deciden
 * está en `src/composicion/rutas-de-sistema.ts` y se prueba sin levantar Next.
 */

/**
 * El cron de Vercel: autorizado con `CRON_SECRET`, encola las reconciliaciones de fiscal, despacha la cola y barre lo
 * vencido de la autenticación.
 */
export function atenderElCron(pedido: Request): Promise<Response> {
  return atenderCron(pedido, {
    secreto: sistema.secretoDeCron,
    procesador: trabajos.procesador,
    barrido: web.barridoDeAutenticacion,
    // Antes de despachar, encola la reconciliación de fiscal de cada empresa que factura (fiscal.reconciliar).
    reconciliaciones: (ahora) => trabajos.encolarReconciliaciones(ahora),
    ahora: () => new Date(),
    // El detalle ya viene con su referencia y filtrado de secretos: solo al registro del servidor.
    registrar: (detalle) => {
      console.error(detalle);
    },
  });
}

/** La salud: `SELECT 1` con el rol de la aplicación; solo «ok» o «no ok». */
export function atenderLaSalud(): Promise<Response> {
  return atenderSalud({ baseResponde: () => sistema.baseResponde()() });
}
