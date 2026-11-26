import type { CuentasDeConsumoParaVender } from "../modulos/cuenta_corriente/publico";
import { esUuidCanonico } from "../primitivas/identificadores/marca";
import type { TxDeApp } from "./conexiones";

/**
 * El adaptador que le da a `cuenta_corriente` la cuenta de consumo que se está vendiendo (CC-5, C3): la composición es el ÚNICO lugar donde se tocan los módulos. Lee, en la MISMA transacción, la cuenta
 * de ventas y devuelve su sucursal solo si está ABIERTA; cualquier otra cosa (no existe, otra empresa, cerrada, anulada) es `null`. Solo lectura; sin la pieza de ventas falla cerrado.
 */
function comoCuentas(tx: object): TxDeApp["cuentas"] {
  if (!Object.hasOwn(tx, "cuentas")) {
    throw new Error("la transacción de la consulta no trae la pieza «cuentas» de ventas");
  }
  return (tx as Pick<TxDeApp, "cuentas">).cuentas;
}

export function crearCuentasDeConsumoParaVender(): CuentasDeConsumoParaVender<object> {
  return {
    async sucursalDeLaCuentaAbierta(tx, empresa, cuentaId) {
      if (!esUuidCanonico(cuentaId)) return null;
      const cuenta = await comoCuentas(tx).obtener(
        empresa,
        cuentaId as Parameters<TxDeApp["cuentas"]["obtener"]>[1],
      );
      return cuenta !== null && cuenta.estado === "ABIERTA" ? cuenta.sucursalId : null;
    },
  };
}
