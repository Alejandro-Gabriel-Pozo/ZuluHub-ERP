import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/**
 * Las consultas por pantalla del catálogo (ADR-005; E2 mínimo §3.6) y la acción que cada una exige al guard (cruce X1). Mirar es de los
 * tres roles. `cotizarParaVender` NO es una consulta de pantalla: es el puerto que usa quien vende, que autoriza con su propia transición.
 */
export const DECLARACIONES_DE_CONSULTAS = {
  listarProductos: { accion: "productos.ver" },
  verProducto: { accion: "productos.ver" },
  preciosDelProducto: { accion: "productos.ver" },
  productosParaConsumo: { accion: "productos.ver" },
  productosParaCopiar: { accion: "productos.ver" },
  listarSeccionesDeCarta: { accion: "productos.ver" },
  verCartaPublica: { accion: "vidrieras.ver" },
  productosOcultos: { accion: "vidrieras.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;
