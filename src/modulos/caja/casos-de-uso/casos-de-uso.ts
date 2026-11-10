import { armarDesactivarCaja, armarReactivarCaja } from "./cambiar-estado-de-caja";
import {
  armarDesactivarCuentaDeCobro,
  armarReactivarCuentaDeCobro,
} from "./cambiar-estado-de-cuenta-de-cobro";
import {
  armarDesactivarMedioDePago,
  armarReactivarMedioDePago,
} from "./cambiar-estado-de-medio-de-pago";
import type { DependenciasDeCaja } from "./contrato";
import { armarCrearCaja } from "./crear-caja";
import { armarCrearCuentaDeCobro } from "./crear-cuenta-de-cobro";
import { armarCrearMedioDePago } from "./crear-medio-de-pago";
import type { DECLARACIONES } from "./declaraciones";
import { armarEditarCaja } from "./editar-caja";
import { armarEditarCuentaDeCobro } from "./editar-cuenta-de-cobro";
import { armarEditarMedioDePago } from "./editar-medio-de-pago";

/**
 * Los casos de uso de la caja, listos para que la composición los ofrezca. El `satisfies` exige que sean EXACTAMENTE los que declara
 * `DECLARACIONES` (qué acción exige cada uno y cómo se repite): uno nuevo sin declarar, o una declaración sin caso de uso, no compila.
 * Hoy, la configuración (cajas, medios de pago y cuentas de cobro); la operación la suman los tramos siguientes.
 */
export function crearCasosDeUsoDeCaja(dependencias: DependenciasDeCaja) {
  return {
    crearCaja: armarCrearCaja(dependencias),
    editarCaja: armarEditarCaja(dependencias),
    desactivarCaja: armarDesactivarCaja(dependencias),
    reactivarCaja: armarReactivarCaja(dependencias),
    crearMedioDePago: armarCrearMedioDePago(dependencias),
    editarMedioDePago: armarEditarMedioDePago(dependencias),
    desactivarMedioDePago: armarDesactivarMedioDePago(dependencias),
    reactivarMedioDePago: armarReactivarMedioDePago(dependencias),
    crearCuentaDeCobro: armarCrearCuentaDeCobro(dependencias),
    editarCuentaDeCobro: armarEditarCuentaDeCobro(dependencias),
    desactivarCuentaDeCobro: armarDesactivarCuentaDeCobro(dependencias),
    reactivarCuentaDeCobro: armarReactivarCuentaDeCobro(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeCaja = ReturnType<typeof crearCasosDeUsoDeCaja>;
