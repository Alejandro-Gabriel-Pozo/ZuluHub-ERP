import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import type { TextosDeVenderACuenta } from "./modelo-de-vender-a-cuenta";

/**
 * Los textos de la hoja «Vender a cuenta corriente» ya resueltos (CC-5 B1b): los ocho nuevos de `cuenta_corriente.vender.*` (DEC-CCL-008) y los que ya existían de la cuenta corriente (Cliente, Estado,
 * Habilitada, Suspendida, Crédito disponible, CUIT y días), que NO se duplican. Acá no se arma ningún texto nuevo.
 */
export function textosDeVenderACuenta(): TextosDeVenderACuenta {
  return {
    titulo: texto({}, "cuenta_corriente.vender.titulo"),
    cliente: texto({}, "fiscal.pantalla.rotulo_cliente"),
    estado: texto({}, "fiscal.pantalla.listado_rotulo_estado"),
    habilitada: texto({}, "cuenta_corriente.estado.habilitada"),
    suspendida: texto({}, "cuenta_corriente.estado.suspendida"),
    saldoActual: texto({}, "cuenta_corriente.vender.saldo_actual"),
    creditoDisponible: texto({}, "cuenta_corriente.credito_disponible"),
    estaVenta: texto({}, "cuenta_corriente.vender.esta_venta"),
    saldoDespues: texto({}, "cuenta_corriente.vender.saldo_despues"),
    confirmar: texto({}, "cuenta_corriente.vender.cargar"),
    elegirOtroCliente: texto({}, "cuenta_corriente.vender.elegir_otro_cliente"),
    superaElLimite: texto({}, "cuenta_corriente.vender.supera_el_limite"),
    sinPermisoParaAprobar: texto({}, "cuenta_corriente.vender.sin_permiso_para_aprobar"),
  };
}

/** «CUIT 30-71234567-4». */
export const rotuloDelCuit = (cuit: string): string =>
  texto({}, "cuenta_corriente.ficha.cuit", { cuit });

/** «30 días» (el plazo del cliente). */
export const rotuloDelPlazo = (dias: number): string =>
  texto({}, "cuenta_corriente.lista.dias", { n: String(dias) });
