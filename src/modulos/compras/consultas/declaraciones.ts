import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/**
 * Las consultas por pantalla de compras (ADR-005; E9 §3.10) y la acción que cada una exige al guard (cruce X1). Todas filtran por la empresa del contexto,
 * que resuelve el servidor. Mirar compras y proveedores es de los tres roles; los costos por unidad (`proveedoresDelProducto`) piden además `costos.ver`
 * (E5): sin ella no se ven costos. `proveedoresDelProducto` pide dos acciones, así que su declaración lista la principal y la consulta suma la segunda.
 */
export const DECLARACIONES_DE_CONSULTAS = {
  fichaDelProveedorParaCompras: { accion: "recepciones.ver" },
  listarCompras: { accion: "recepciones.ver" },
  fichaDeCompra: { accion: "recepciones.ver" },
  comprasSinPrecio: { accion: "recepciones.ver" },
  proveedoresDelProducto: { accion: "costos.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;
