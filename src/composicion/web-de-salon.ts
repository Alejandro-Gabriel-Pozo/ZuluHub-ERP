import { crearCasosDeUsoDeSalon, crearConsultasDeSalon } from "../modulos/salon/publico";
import { perezoso } from "./perezoso";
import { crearStockDeVentas } from "./stock-de-ventas";
import type { BaseDeWeb } from "./web-base";

export function armarWebDeSalon({ conexiones, reglas }: BaseDeWeb) {
  return {
    /**
     * Salón (E7): las mesas y su plano, el pedido de la mesa, el envío a cocina desde la mesa, cambiar de mesa, unir, dividir y cobrar la mesa. Orquesta
     * ventas y comandas en la MISMA transacción; descuenta stock por el mismo puerto que ventas (la composición es el único lugar donde se tocan). El
     * módulo está `disponible` desde S-0r (17/11/2026, DEC-0714), con la perilla `salon` del plan apagada de base (extra de pago).
     */
    casosDeUsoDeSalon: perezoso(() =>
      crearCasosDeUsoDeSalon({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        stock: crearStockDeVentas(reglas),
      }),
    ),
    consultasDeSalon: perezoso(() =>
      crearConsultasDeSalon({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
  };
}
