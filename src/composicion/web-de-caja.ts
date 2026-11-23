import { crearCasosDeUsoDeCaja, crearConsultasDeCaja } from "../modulos/caja/publico";
import { ticketsPorCobranzaDeLaComposicion } from "./cierre-de-caja";
import { perezoso } from "./perezoso";
import type { BaseDeWeb } from "./web-base";

export function armarWebDeCaja({ conexiones, reglas }: BaseDeWeb) {
  return {
    /**
     * La configuración de caja (E3): cajas, medios de pago y cuentas de cobro, cada caso con su acción de `caja`. El módulo sigue «en
     * desarrollo» en el catálogo: el guard lo rechaza con `MODULO_EN_DESARROLLO` hasta que el tramo final lo declare disponible.
     * La operación (sesiones, movimientos, cobro) y el cierre del día de caja (corregir un medio, declarar totales, la conciliación) salen por acá.
     */
    casosDeUsoDeCaja: perezoso(() =>
      crearCasosDeUsoDeCaja({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    consultasDeCaja: perezoso(() =>
      crearConsultasDeCaja({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        // El total vigente de los tickets, que ventas informará cuando exista (E4): hoy, fail-closed (`cierre-de-caja.ts`).
        tickets: ticketsPorCobranzaDeLaComposicion,
      }),
    ),
  };
}
