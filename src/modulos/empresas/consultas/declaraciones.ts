import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/**
 * Las consultas por pantalla de empresas (ADR-005; H6, especificación §B.5) y la acción que cada una
 * exige al guard (cruce X1 de ADR-003). Se declaran en el tramo T0 para que los tramos paralelos no
 * se pisen; las de sucursales se implementan en T2 y las de plan y permisos en T5.
 */
export const DECLARACIONES_DE_CONSULTAS = {
  listarSucursales: { accion: "sucursales.ver" },
  fichaDeSucursal: { accion: "sucursales.ver" },
  planYModulos: { accion: "modulos.ver" },
  permisosDelActor: { accion: "permisos.ver_propios" },
} as const satisfies Record<string, DeclaracionDeCaso>;
