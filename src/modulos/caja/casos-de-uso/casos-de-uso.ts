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
import { armarAbrirSesion } from "./abrir-sesion";
import { armarAnularMovimientoDeCaja } from "./anular-movimiento";
import { armarCancelarCierre } from "./cancelar-cierre";
import { armarCerrarSesion } from "./cerrar-sesion";
import { armarCrearCaja } from "./crear-caja";
import { armarCrearCuentaDeCobro } from "./crear-cuenta-de-cobro";
import { armarCrearMedioDePago } from "./crear-medio-de-pago";
import { armarCorregirMedioDeCobro } from "./corregir-medio-de-cobro";
import { armarDarConformeGeneral } from "./dar-conforme-general";
import { armarDeclararTotal } from "./declarar-total";
import type { DECLARACIONES } from "./declaraciones";
import { armarAsegurarCajaPorDefecto } from "./caja-por-defecto";
import { armarEditarCaja } from "./editar-caja";
import { armarEditarCuentaDeCobro } from "./editar-cuenta-de-cobro";
import { armarEditarMedioDePago } from "./editar-medio-de-pago";
import { armarIniciarCierre } from "./iniciar-cierre";
import { armarRegistrarAjuste } from "./registrar-ajuste";
import { armarRegistrarMovimientoManual } from "./registrar-movimiento-manual";

/**
 * Los casos de uso de la caja, listos para que la composición los ofrezca. El `satisfies` exige que sean EXACTAMENTE los que declara
 * `DECLARACIONES` (qué acción exige cada uno y cómo se repite): uno nuevo sin declarar, o una declaración sin caso de uso, no compila.
 * La configuración (cajas, medios de pago y cuentas de cobro) y la operación de la caja (sesión, cierre, movimientos manuales, ajustes y
 * anulaciones) y la contribución al cierre del día (corregir el medio de un cobro, declarar un total y el «conforme general»).
 */
export function crearCasosDeUsoDeCaja(dependencias: DependenciasDeCaja) {
  return {
    crearCaja: armarCrearCaja(dependencias),
    asegurarCajaPorDefecto: armarAsegurarCajaPorDefecto(dependencias),
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
    abrirSesion: armarAbrirSesion(dependencias),
    iniciarCierre: armarIniciarCierre(dependencias),
    cancelarCierre: armarCancelarCierre(dependencias),
    cerrarSesion: armarCerrarSesion(dependencias),
    registrarMovimientoManual: armarRegistrarMovimientoManual(dependencias),
    registrarAjuste: armarRegistrarAjuste(dependencias),
    anularMovimientoDeCaja: armarAnularMovimientoDeCaja(dependencias),
    corregirMedioDeCobro: armarCorregirMedioDeCobro(dependencias),
    declararTotal: armarDeclararTotal(dependencias),
    darConformeGeneral: armarDarConformeGeneral(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeCaja = ReturnType<typeof crearCasosDeUsoDeCaja>;
