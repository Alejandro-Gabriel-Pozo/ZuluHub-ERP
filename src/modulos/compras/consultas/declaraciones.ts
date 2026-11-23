import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/**
 * Las consultas por pantalla de compras (ADR-005; E9 §3.10) y la acción que cada una exige al guard (cruce X1). Todas filtran por la empresa del contexto,
 * que resuelve el servidor. Mirar compras y proveedores es de los tres roles; los costos por unidad (`proveedoresDelProducto`) piden además `costos.ver`
 * (E5): sin ella no se ven costos. `proveedoresDelProducto` pide dos acciones, así que su declaración lista la propia (`recepciones.ver`) y la consulta suma `costos.ver`, que es de stock.
 */
export const DECLARACIONES_DE_CONSULTAS = {
  fichaDelProveedorParaCompras: { accion: "recepciones.ver" },
  comprobantesDelProveedor: { accion: "comprobantes_de_proveedor.ver" },
  listarCompras: { accion: "recepciones.ver" },
  fichaDeCompra: { accion: "recepciones.ver" },
  comprasSinPrecio: { accion: "recepciones.ver" },
  productosParaComprar: { accion: "recepciones.ver" },
  proveedoresDelProducto: { accion: "recepciones.ver" },
  proponerConciliacion: { accion: "conciliaciones.ver" },
  listarRecepcionesSeparadas: { accion: "recepciones.ver" },
  listarFacturasSeparadas: { accion: "comprobantes_de_proveedor.ver" },
  listarOrdenes: { accion: "ordenes_de_compra.ver" },
  obtenerOrden: { accion: "ordenes_de_compra.ver" },
  listarDevoluciones: { accion: "devoluciones_a_proveedor.ver" },
  obtenerDevolucion: { accion: "devoluciones_a_proveedor.ver" },
  listarNotasDeCredito: { accion: "notas_de_credito_de_proveedor.ver" },
  obtenerNotaDeCredito: { accion: "notas_de_credito_de_proveedor.ver" },
  listarDiferencias: { accion: "diferencias_de_compra.ver" },
  obtenerTolerancias: { accion: "diferencias_de_compra.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;
