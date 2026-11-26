import { crearCasosDeUsoDeStock, crearConsultasDeStock } from "../modulos/stock/publico";
import { cuentasAbiertasDeVentasParaStock } from "./cuentas-abiertas-de-stock";
import { perezoso } from "./perezoso";
import type { BaseDeWeb } from "./web-base";

export function armarWebDeStock({ conexiones, reglas }: BaseDeWeb) {
  return {
    /**
     * Stock (E5): depósitos, artículos, movimientos, conteos y composiciones (casos de uso) y sus consultas, cada uno con SU acción de `stock`. El
     * módulo sigue `en_desarrollo` hasta que el dueño lo pase a disponible: el guard rechaza todo con `MODULO_EN_DESARROLLO`. Los puertos que
     * ofrece a ventas y a compras (`crearPuertosDeStock`) no salen por acá: corren en la transacción de quien los llama y no tienen acción propia.
     */
    casosDeUsoDeStock: perezoso(() =>
      crearCasosDeUsoDeStock({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        cuentasAbiertas: cuentasAbiertasDeVentasParaStock,
      }),
    ),
    consultasDeStock: perezoso(() =>
      crearConsultasDeStock({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
  };
}
