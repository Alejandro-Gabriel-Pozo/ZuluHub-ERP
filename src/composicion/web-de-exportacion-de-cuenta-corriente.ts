import { crearCasosDeUsoDeCuentaCorriente } from "../modulos/cuenta_corriente/publico";
import { crearApoyoDeLaExportacionDeCuentaCorriente } from "./apoyo-de-exportacion-de-cuenta-corriente";
import { perezoso } from "./perezoso";
import type { BaseDeWeb } from "./web-base";

export function armarWebDeLaExportacionDeCuentaCorriente({ conexiones, reglas }: BaseDeWeb) {
  return {
    /**
     * La exportación de la cuenta corriente de clientes a Excel (CC-5 D): SOLO `exportarCuentaCorriente`, con su acción `cuenta_corriente.ver`. El apoyo de caja y empresas (el medio de
     * cada cobro y el nombre de las sucursales) lo arma esta composición, el único lugar donde se tocan los módulos; sin él la exportación se rechaza (nace cerrado). Los demás casos de
     * uso de la cuenta corriente no se exponen acá: llegan con su pantalla.
     */
    exportacionDeCuentaCorriente: perezoso(() => {
      const { exportarCuentaCorriente } = crearCasosDeUsoDeCuentaCorriente({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        apoyoDeLaExportacion: crearApoyoDeLaExportacionDeCuentaCorriente(),
      });
      return { exportarCuentaCorriente };
    }),
  };
}
