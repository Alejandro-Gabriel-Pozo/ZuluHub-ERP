import type { DependenciasDeConsultasDeCuentaCorriente } from "./ver-cuenta";
import type { DependenciasDeEstadoDeCuenta } from "./ver-estado-de-cuenta";
import { armarVerCuentaDelCliente } from "./ver-cuenta";
import { armarListarClientesConCuenta } from "./listar-clientes-con-cuenta";
import { armarListarClientesParaVender } from "./listar-clientes-para-vender";
import { armarListarClientesSinCuenta } from "./listar-clientes-sin-cuenta";
import { armarVerEstadoDeCuenta } from "./ver-estado-de-cuenta";
import type { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/**
 * Las consultas de la cuenta corriente de clientes, listas para que la composición las ofrezca. El `satisfies` exige que sean EXACTAMENTE las declaradas en
 * `DECLARACIONES_DE_CONSULTAS`: una nueva sin declarar su acción no compila.
 */
export function crearConsultasDeCuentaCorriente(
  dependencias: DependenciasDeConsultasDeCuentaCorriente & DependenciasDeEstadoDeCuenta,
) {
  return {
    verCuentaDelCliente: armarVerCuentaDelCliente(dependencias),
    verEstadoDeCuenta: armarVerEstadoDeCuenta(dependencias),
    listarClientesConCuenta: armarListarClientesConCuenta(dependencias),
    listarClientesParaVender: armarListarClientesParaVender(dependencias),
    listarClientesSinCuenta: armarListarClientesSinCuenta(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_CONSULTAS, unknown>;
}

export type ConsultasDeCuentaCorriente = ReturnType<typeof crearConsultasDeCuentaCorriente>;
