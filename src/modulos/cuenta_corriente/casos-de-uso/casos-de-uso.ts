import { armarCambiarCondicionesDeLaCuenta } from "./cambiar-condiciones";
import {
  anularCargoDeVentaEnTx,
  anularCobranzaDeVentaEnTx,
  aprobarExcesoEnTx,
  cargarVentaEnTx,
  cobrarVentaEnTx,
} from "./cargar-venta";
import { armarReactivarCuentaDelCliente, armarSuspenderCuentaDelCliente } from "./cambiar-estado";
import type { DependenciasDeCuentaCorriente } from "./contrato";
import type { DECLARACIONES } from "./declaraciones";
import { armarHabilitarCuentaDelCliente } from "./habilitar";

/** Los argumentos de un caso de uso en la transacción del llamador, sin las reglas (las pone el módulo). */
type DesdeLaTx<F extends (...argumentos: never[]) => unknown> = F extends (
  a: infer A,
  b: infer B,
  r: never,
  c: infer C,
) => unknown
  ? [A, B, C]
  : never;

/**
 * Los casos de uso de la ficha de cuenta corriente, listos para que la composición los ofrezca. El `satisfies` exige que sean EXACTAMENTE los que declara
 * `DECLARACIONES` (qué acción exige cada uno y cómo se repite): uno nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeCuentaCorriente(dependencias: DependenciasDeCuentaCorriente) {
  return {
    habilitarCuentaDelCliente: armarHabilitarCuentaDelCliente(dependencias),
    suspenderCuentaDelCliente: armarSuspenderCuentaDelCliente(dependencias),
    reactivarCuentaDelCliente: armarReactivarCuentaDelCliente(dependencias),
    cambiarCondicionesDeLaCuenta: armarCambiarCondicionesDeLaCuenta(dependencias),
    // CC-2: corren en la transacción del llamador (ventas), con las reglas de esta empresa.
    cargarVentaEnTx: (...argumentos: DesdeLaTx<typeof cargarVentaEnTx>) =>
      cargarVentaEnTx(argumentos[0], argumentos[1], dependencias.reglas, argumentos[2]),
    aprobarExcesoEnTx: (...argumentos: DesdeLaTx<typeof aprobarExcesoEnTx>) =>
      aprobarExcesoEnTx(argumentos[0], argumentos[1], dependencias.reglas, argumentos[2]),
    anularCargoDeVentaEnTx,
    cobrarVentaEnTx,
    anularCobranzaDeVentaEnTx,
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeCuentaCorriente = ReturnType<typeof crearCasosDeUsoDeCuentaCorriente>;
