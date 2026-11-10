import { armarAbrirCuenta } from "./abrir-cuenta";
import { armarAgregarLinea } from "./agregar-linea";
import { armarAnularCuenta } from "./anular-cuenta";
import { armarAnularLinea } from "./anular-linea";
import { armarAnularTicket } from "./anular-ticket";
import { armarCerrarCuenta } from "./cerrar-cuenta";
import type { DependenciasDeVentas } from "./contrato";
import type { DECLARACIONES } from "./declaraciones";

/**
 * Los casos de uso de ventas (E4 fase A), listos para que la composición los ofrezca. El `satisfies` exige que sean EXACTAMENTE los que
 * declara `DECLARACIONES`: uno nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeVentas(dependencias: DependenciasDeVentas) {
  return {
    abrirCuenta: armarAbrirCuenta(dependencias),
    agregarLinea: armarAgregarLinea(dependencias),
    anularLinea: armarAnularLinea(dependencias),
    anularCuenta: armarAnularCuenta(dependencias),
    cerrarCuenta: armarCerrarCuenta(dependencias),
    anularTicket: armarAnularTicket(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeVentas = ReturnType<typeof crearCasosDeUsoDeVentas>;
