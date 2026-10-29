import type { DependenciasDeConsultasDeEmpresas } from "./contrato";
import type { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { armarFichaDeSucursal } from "./ficha-de-sucursal";
import { armarListarSucursales } from "./listar-sucursales";
import { armarPermisosDelActor } from "./permisos-del-actor";
import { armarSucursalesElegibles } from "./sucursales-elegibles";

/**
 * Las consultas por pantalla de empresas (ADR-005). El `satisfies` exige que cada una tenga su
 * declaración (qué acción exige): una consulta sin declarar, o con una acción que no existe en el
 * catálogo, no compila. `planYModulos` la suma el tramo T5 de H6, y entonces este `Partial` pasa a
 * ser un `Record`.
 */
export function crearConsultasDeEmpresas(dependencias: DependenciasDeConsultasDeEmpresas) {
  return {
    listarSucursales: armarListarSucursales(dependencias),
    fichaDeSucursal: armarFichaDeSucursal(dependencias),
    sucursalesElegibles: armarSucursalesElegibles(dependencias),
    permisosDelActor: armarPermisosDelActor(dependencias),
  } satisfies Partial<Record<keyof typeof DECLARACIONES_DE_CONSULTAS, unknown>>;
}

export type ConsultasDeEmpresas = ReturnType<typeof crearConsultasDeEmpresas>;
