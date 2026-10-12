import { armarCrearSucursal } from "./crear-sucursal";
import type { DependenciasDeEmpresas } from "./contrato";
import { armarDesactivarSucursal } from "./desactivar-sucursal";
import type { DECLARACIONES } from "./declaraciones";
import { armarEditarSucursal } from "./editar-sucursal";
import { armarReactivarSucursal } from "./reactivar-sucursal";

/**
 * Los casos de uso de empresas (H6: sucursales), listos para que la composición los ofrezca. El
 * `satisfies` exige que sean EXACTAMENTE los que declara `DECLARACIONES` (qué acción exige cada
 * uno): un caso de uso nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeEmpresas(dependencias: DependenciasDeEmpresas) {
  return {
    crearSucursal: armarCrearSucursal(dependencias),
    editarSucursal: armarEditarSucursal(dependencias),
    desactivarSucursal: armarDesactivarSucursal(dependencias),
    reactivarSucursal: armarReactivarSucursal(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeEmpresas = ReturnType<typeof crearCasosDeUsoDeEmpresas>;
