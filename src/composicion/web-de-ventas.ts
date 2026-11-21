import { crearCasosDeUsoDeVentas, crearConsultasDeVentas } from "../modulos/ventas/publico";
import { crearFacturadorDeTickets } from "./facturacion-de-tickets";
import { perezoso } from "./perezoso";
import { crearStockDeVentas } from "./stock-de-ventas";
import type { BaseDeWeb } from "./web-base";

export function armarWebDeVentas({ conexiones, reglas }: BaseDeWeb) {
  return {
    /**
     * Ventas (E4): abrir, cargar, anular y cerrar la cuenta y anular el ticket, cada uno con SU acción. El módulo sigue `en_desarrollo`: el
     * guard rechaza todo con `MODULO_EN_DESARROLLO` hasta que el dueño lo pase a disponible.
     */
    casosDeUsoDeVentas: perezoso(() =>
      crearCasosDeUsoDeVentas({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        // Facturar un ticket (E1 §3.4): la composición es el único lugar donde ventas y fiscal se tocan.
        facturador: crearFacturadorDeTickets(reglas),
        // Descontar y devolver stock al cerrar y anular un ticket (E5-T12): la composición es el único lugar donde ventas y stock se tocan.
        stock: crearStockDeVentas(reglas),
      }),
    ),
    consultasDeVentas: perezoso(() =>
      crearConsultasDeVentas({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        facturador: crearFacturadorDeTickets(reglas),
      }),
    ),
  };
}
