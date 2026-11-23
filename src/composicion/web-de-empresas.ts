import { ganchoDeSucursalDeCaja } from "../modulos/caja/publico";
import { crearGanchoDeCierreAlDesactivar } from "../modulos/cierre/publico";
import { crearCasosDeUsoDeEmpresas, crearConsultasDeEmpresas } from "../modulos/empresas/publico";
import { APORTES_AL_CIERRE } from "./aportes-al-cierre";
import { perezoso } from "./perezoso";
import type { BaseDeWeb } from "./web-base";

export function armarWebDeEmpresas({ conexiones, reglas }: BaseDeWeb) {
  return {
    casosDeUsoDeEmpresas: perezoso(() =>
      crearCasosDeUsoDeEmpresas({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        // Lo que nace con cada sucursal (decisión 165): «Caja 1», en la misma transacción que la sucursal.
        ganchosDeSucursal: [ganchoDeSucursalDeCaja],
        // Desactivar una sucursal (decisión 178): no con la jornada en auditoría; abierta sin movimiento se cierra sola; con movimiento
        // se pide el cierre del día. Pregunta a los mismos aportes que el cierre (hoy, caja; ventas lo suma E4).
        ganchosAlDesactivarSucursal: [
          crearGanchoDeCierreAlDesactivar({ reglas, aportes: APORTES_AL_CIERRE }),
        ],
      }),
    ),
    consultasDeEmpresas: perezoso(() =>
      crearConsultasDeEmpresas({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
  };
}
