import {
  crearCasosDeUsoDeProduccion,
  crearConsultasDeProduccion,
} from "../modulos/produccion/publico";
import { perezoso } from "./perezoso";
import type { BaseDeWeb } from "./web-base";

export function armarWebDeProduccion({ conexiones, reglas }: BaseDeWeb) {
  return {
    /**
     * Producción (E6): abrir, cerrar, cancelar y anular órdenes (casos de uso) y sus consultas, cada uno con SU acción de `transformaciones`. El módulo
     * sigue `en_desarrollo` hasta que el dueño lo pase a disponible: el guard rechaza todo con `MODULO_EN_DESARROLLO`. Escribe el libro de stock por
     * `stock/publico.ts`, dentro de la MISMA transacción de la orden.
     */
    casosDeUsoDeProduccion: perezoso(() =>
      crearCasosDeUsoDeProduccion({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    consultasDeProduccion: perezoso(() =>
      crearConsultasDeProduccion({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
  };
}
