import { crearConsultasDeCuentaCorriente } from "../modulos/cuenta_corriente/publico";
import { crearApoyoDeLaExportacionDeCuentaCorriente } from "./apoyo-de-exportacion-de-cuenta-corriente";
import { perezoso } from "./perezoso";
import type { BaseDeWeb } from "./web-base";

export function armarWebDeCuentaCorriente({ conexiones, reglas }: BaseDeWeb) {
  return {
    /**
     * Cuenta corriente de clientes (CC-5, A1): las consultas de la lista de clientes con cuenta y de la ficha con su estado de cuenta, cada una con SU acción (`cuenta_corriente.ver`). El apoyo de
     * ventas, caja y empresas (el ticket de cada movimiento, el medio de cada cobro y el nombre de las sucursales) lo arma esta composición: es el único lugar donde se tocan los módulos. Los casos
     * de uso (habilitar, suspender, reactivar y cambiar condiciones) llegan con el PR siguiente.
     */
    consultasDeCuentaCorriente: perezoso(() =>
      crearConsultasDeCuentaCorriente({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        apoyo: crearApoyoDeLaExportacionDeCuentaCorriente(),
      }),
    ),
  };
}
