import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/**
 * Los casos de uso de configuración fiscal del gerente (spec H7 fiscal §C, tramo T5) y la acción que cada uno exige
 * al guard (cruce X1 de ADR-003). Las siete acciones son del módulo `administracion` (obligatorio, nunca en solo
 * lectura ni en desarrollo) y solo del gerente (C11): el gerente tiene que poder confirmar sus datos fiscales y
 * activar un punto de venta ANTES de que exista la facturación, porque son sus `datosRequeridos`.
 */
export const DECLARACIONES_DE_CONFIGURACION = {
  guardarBorradorDeDatosFiscales: { accion: "datos_fiscales.editar" },
  confirmarDatosFiscales: { accion: "datos_fiscales.confirmar" },
  crearPuntoDeVenta: { accion: "puntos_de_venta.crear" },
  editarPuntoDeVenta: { accion: "puntos_de_venta.editar" },
  activarPuntoDeVenta: { accion: "puntos_de_venta.activar" },
  desactivarPuntoDeVenta: { accion: "puntos_de_venta.desactivar" },
  confirmarReglaDeEmisor: { accion: "emisores.confirmar_regla" },
} as const satisfies Record<string, DeclaracionDeCaso>;
