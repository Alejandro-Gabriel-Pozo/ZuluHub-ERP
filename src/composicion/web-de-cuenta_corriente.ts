import {
  crearCasosDeUsoDeCuentaCorriente,
  crearConsultasDeCuentaCorriente,
} from "../modulos/cuenta_corriente/publico";
import { crearApoyoDeLaExportacionDeCuentaCorriente } from "./apoyo-de-exportacion-de-cuenta-corriente";
import { perezoso } from "./perezoso";
import type { BaseDeWeb } from "./web-base";

export function armarWebDeCuentaCorriente({ conexiones, reglas }: BaseDeWeb) {
  return {
    /**
     * Cuenta corriente de clientes (CC-5, A1): las consultas de la lista de clientes con cuenta y de la ficha con su estado de cuenta, cada una con SU acción (`cuenta_corriente.ver`). El apoyo de
     * ventas, caja y empresas (el ticket de cada movimiento, el medio de cada cobro y el nombre de las sucursales) lo arma esta composición: es el único lugar donde se tocan los módulos. Los casos
     * de uso de la ficha (habilitar, suspender, reactivar y cambiar condiciones; A2) corren cada uno con su acción (`cuenta_corriente.administrar`); los que corren dentro de la transacción de ventas no salen por acá.
     */
    consultasDeCuentaCorriente: perezoso(() =>
      crearConsultasDeCuentaCorriente({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        apoyo: crearApoyoDeLaExportacionDeCuentaCorriente(),
      }),
    ),
    casosDeUsoDeCuentaCorriente: perezoso(() => {
      const casos = crearCasosDeUsoDeCuentaCorriente({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        // El apoyo de ventas, caja y empresas que necesita la exportación (CC-5 D); sin él `exportarCuentaCorriente` se rechaza (nace cerrado).
        apoyoDeLaExportacion: crearApoyoDeLaExportacionDeCuentaCorriente(),
      });
      // Solo los de la ficha y la exportación a Excel, que tienen guard propio: los que corren en la transacción de ventas (cargar, cobrar, anular) no salen a la web.
      return {
        habilitarCuentaDelCliente: casos.habilitarCuentaDelCliente,
        cambiarCondicionesDeLaCuenta: casos.cambiarCondicionesDeLaCuenta,
        suspenderCuentaDelCliente: casos.suspenderCuentaDelCliente,
        reactivarCuentaDelCliente: casos.reactivarCuentaDelCliente,
        exportarCuentaCorriente: casos.exportarCuentaCorriente,
      };
    }),
  };
}
