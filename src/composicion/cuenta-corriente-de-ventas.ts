import type { ReglasDeEmpresa } from "../capacidades/permisos/empresa";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  anularCargoDeVentaEnTx,
  anularCobranzaDeVentaEnTx,
  cargarVentaEnTx,
  cobrarVentaEnTx,
  type ErrorDelCargoDeVenta,
  type TxDeCargoDeVenta,
} from "../modulos/cuenta_corriente/publico";
import type { CuentaCorrienteDeVentas, ErrorDelCargoACuenta } from "../modulos/ventas/publico";

/**
 * El adaptador que une ventas y la cuenta corriente de clientes (CC-2): la composición es el ÚNICO lugar donde se tocan los dos módulos. Traduce el puerto de ventas (`CuentaCorrienteDeVentas`, tipos
 * propios) a los casos de uso de `cuenta_corriente` (la ficha, el límite, la aprobación y el asiento del libro) y los llama con la MISMA `tx`: la `TxDeApp` ya compone los repositorios de ventas, de la ficha y
 * del libro sobre la misma conexión, así el ticket y su cargo son todo o nada. Los motivos de la cuenta salen con su código; todo lo que viene del libro es `CARGO_A_CUENTA_RECHAZADO`.
 */
const PIEZAS = [
  "cuentasDeClientes",
  "asientos",
  "imputaciones",
  "saldos",
  "auditoria",
  "autorizacion",
] as const;

/** La transacción que recibe el puerto es la de ventas; en la composición es SIEMPRE la `TxDeApp`. Sin las piezas de la ficha y del libro falla cerrado antes de escribir. */
function comoTxDeCargo(tx: object): TxDeCargoDeVenta {
  for (const pieza of PIEZAS) {
    if (!Object.hasOwn(tx, pieza)) {
      throw new Error(
        `la transacción de ventas no trae la pieza de la cuenta corriente «${pieza}»`,
      );
    }
  }
  return tx as TxDeCargoDeVenta;
}

const MOTIVOS_PROPIOS: readonly ErrorDelCargoDeVenta[] = [
  "CLIENTE_SIN_CUENTA_HABILITADA",
  "CUENTA_SUSPENDIDA",
  "EXCEDE_EL_LIMITE",
];

const codigoDelCargo = (error: ErrorDelCargoDeVenta): ErrorDelCargoACuenta =>
  MOTIVOS_PROPIOS.includes(error) ? (error as ErrorDelCargoACuenta) : "CARGO_A_CUENTA_RECHAZADO";

export function crearCuentaCorrienteDeVentas(
  reglas: ReglasDeEmpresa,
): CuentaCorrienteDeVentas<object> {
  return {
    async cargarEnTx(tx, contexto, entrada) {
      const r = await cargarVentaEnTx(comoTxDeCargo(tx), contexto, reglas, entrada);
      return r.ok ? ok(r.valor) : err(codigoDelCargo(r.error));
    },
    async cobrarEnTx(tx, contexto, entrada) {
      const r = await cobrarVentaEnTx(comoTxDeCargo(tx), contexto, entrada);
      return r.ok ? ok(r.valor) : err(codigoDelCargo(r.error));
    },
    async anularCobranzaEnTx(tx, contexto, entrada) {
      const r = await anularCobranzaDeVentaEnTx(comoTxDeCargo(tx), contexto, entrada);
      return r.ok ? ok(r.valor) : err(codigoDelCargo(r.error));
    },
    async anularEnTx(tx, contexto, entrada) {
      const r = await anularCargoDeVentaEnTx(comoTxDeCargo(tx), contexto, entrada);
      return r.ok ? ok(r.valor) : err(codigoDelCargo(r.error));
    },
  };
}
