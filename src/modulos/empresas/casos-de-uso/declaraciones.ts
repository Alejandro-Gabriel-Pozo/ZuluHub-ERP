import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/**
 * Los casos de uso de sucursales (H6, especificación §B.1) y la acción que cada uno exige al guard
 * (cruce X1 de ADR-003). Se declaran en el tramo T0 para que los tramos paralelos no se pisen; cada
 * caso de uso se implementa en T2.
 */
export const DECLARACIONES = {
  crearSucursal: { accion: "sucursales.crear" },
  editarSucursal: { accion: "sucursales.editar" },
  desactivarSucursal: { accion: "sucursales.desactivar" },
  reactivarSucursal: { accion: "sucursales.reactivar" },
} as const satisfies Record<string, DeclaracionDeCaso>;
