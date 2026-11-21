import { crearCasosDeUsoDeCierre, crearConsultasDeCierre } from "../modulos/cierre/publico";
import { APORTES_AL_CIERRE } from "./aportes-al-cierre";
import { perezoso } from "./perezoso";
import type { BaseDeWeb } from "./web-base";

export function armarWebDeCierre({ conexiones, reglas }: BaseDeWeb) {
  return {
    /**
     * El cierre del día (E3b): iniciar y cancelar la auditoría y cerrar la jornada, cada uno con su acción de `cierre`. Los aportes de los
     * módulos que tienen algo que revisar los registra cada etapa en `aportes`: hoy el de caja (E3, tramo 8; solo cuenta si la empresa tiene
     * `caja` activo); el de ventas lo suma E4.
     */
    casosDeUsoDeCierre: perezoso(() =>
      crearCasosDeUsoDeCierre({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        aportes: APORTES_AL_CIERRE,
      }),
    ),
    consultasDeCierre: perezoso(() =>
      crearConsultasDeCierre({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        aportes: APORTES_AL_CIERRE,
      }),
    ),
  };
}
