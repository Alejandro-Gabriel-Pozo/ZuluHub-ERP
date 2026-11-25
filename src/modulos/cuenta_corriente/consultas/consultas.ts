import type { DependenciasDeConsultasDeCuentaCorriente } from "./ver-cuenta";
import { armarVerCuentaDelCliente } from "./ver-cuenta";
import type { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/**
 * Las consultas de la cuenta corriente de clientes, listas para que la composición las ofrezca. El `satisfies` exige que sean EXACTAMENTE las declaradas en
 * `DECLARACIONES_DE_CONSULTAS`: una nueva sin declarar su acción no compila.
 */
export function crearConsultasDeCuentaCorriente(
  dependencias: DependenciasDeConsultasDeCuentaCorriente,
) {
  return {
    verCuentaDelCliente: armarVerCuentaDelCliente(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_CONSULTAS, unknown>;
}

export type ConsultasDeCuentaCorriente = ReturnType<typeof crearConsultasDeCuentaCorriente>;
