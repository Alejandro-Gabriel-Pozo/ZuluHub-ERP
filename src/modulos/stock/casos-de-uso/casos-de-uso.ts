import { armarControlarArticulo, armarDejarDeControlar } from "./articulos";
import {
  armarAbrirConteo,
  armarAplicarConteo,
  armarCancelarConteo,
  armarRegistrarConteo,
} from "./conteos";
import { armarCambiarCalidadDeLote, armarControlarLote, armarDejarDeControlarLote } from "./lotes";
import { armarCorregirLote } from "./corregir-lote";
import { armarReasignarLote } from "./reasignar-lote";
import { armarGuardarComposicion, armarRetirarComposicion } from "./composiciones";
import type { DependenciasDeStock } from "./contrato";
import type { DECLARACIONES } from "./declaraciones";
import { armarAnularMovimiento } from "./anulaciones";
import {
  armarAjustar,
  armarRegistrarEntrada,
  armarRegistrarSalida,
  armarTransferir,
} from "./movimientos";
import {
  armarCrearDeposito,
  armarDesactivarDeposito,
  armarEditarDeposito,
  armarReactivarDeposito,
} from "./depositos";

/**
 * Los casos de uso de stock, listos para que la composición los ofrezca. El `satisfies` exige que sean EXACTAMENTE los que declara
 * `DECLARACIONES` (qué acción exige cada uno y cómo se repite): uno nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeStock(dependencias: DependenciasDeStock) {
  return {
    // depósitos y artículos (E5-T4)
    crearDeposito: armarCrearDeposito(dependencias),
    editarDeposito: armarEditarDeposito(dependencias),
    desactivarDeposito: armarDesactivarDeposito(dependencias),
    reactivarDeposito: armarReactivarDeposito(dependencias),
    controlarArticulo: armarControlarArticulo(dependencias),
    dejarDeControlar: armarDejarDeControlar(dependencias),
    // movimientos (E5-T5)
    registrarEntrada: armarRegistrarEntrada(dependencias),
    registrarSalida: armarRegistrarSalida(dependencias),
    transferir: armarTransferir(dependencias),
    ajustar: armarAjustar(dependencias),
    anularMovimiento: armarAnularMovimiento(dependencias),
    // conteo físico (E5-T6)
    abrirConteo: armarAbrirConteo(dependencias),
    registrarConteo: armarRegistrarConteo(dependencias),
    aplicarConteo: armarAplicarConteo(dependencias),
    cancelarConteo: armarCancelarConteo(dependencias),
    // composiciones (E5-T7)
    guardarComposicion: armarGuardarComposicion(dependencias),
    retirarComposicion: armarRetirarComposicion(dependencias),
    // lotes y calidad (E6-T7)
    controlarLote: armarControlarLote(dependencias),
    dejarDeControlarLote: armarDejarDeControlarLote(dependencias),
    cambiarCalidadDeLote: armarCambiarCalidadDeLote(dependencias),
    corregirLote: armarCorregirLote(dependencias),
    reasignarLote: armarReasignarLote(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeStock = ReturnType<typeof crearCasosDeUsoDeStock>;
