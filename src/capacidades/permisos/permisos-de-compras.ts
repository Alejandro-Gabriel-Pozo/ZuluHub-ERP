import type { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import type { RolDeEmpresa } from "./roles";

export const PERMISOS_DE_COMPRAS = {
  // Compras (P-3, DECIDIDO por el padre el 10/11/2026, corregible): el operador carga la compra y la factura y pide
  // puntos de venta o comprobantes; no paga, no anula, no corrige ni configura. Aprobar la ficha es de quien administra
  // (D111); el nivel de operación es solo del gerente.
  "proveedores.editar_ficha": ["GERENTE", "ADMINISTRADOR"],
  "proveedores.pedir_ficha": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "recepciones.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "recepciones.registrar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "recepciones.anular": ["GERENTE", "ADMINISTRADOR"],
  "recepciones.confirmar": ["GERENTE", "ADMINISTRADOR"],
  "comprobantes_de_proveedor.anular": ["GERENTE", "ADMINISTRADOR"],
  "conciliaciones.ver": ["GERENTE", "ADMINISTRADOR"],
  "conciliaciones.conciliar": ["GERENTE", "ADMINISTRADOR"],
  "conciliaciones.anular": ["GERENTE", "ADMINISTRADOR"],
  "comprobantes_de_proveedor.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "comprobantes_de_proveedor.registrar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "comprobantes_de_proveedor.pagar": ["GERENTE", "ADMINISTRADOR"],
  "comprobantes_de_proveedor.anular_pago": ["GERENTE", "ADMINISTRADOR"],
  "comprobantes_de_proveedor.reemplazar": ["GERENTE", "ADMINISTRADOR"],
  // Órdenes de compra (N4, decisión del dueño del 16/11/2026): crear, pedir, cerrar y anular una orden es de quien administra o gerencia, no del operador; mirarla es de los tres
  // (el operador la ve sin precios: los precios piden además `costos.ver`).
  "ordenes_de_compra.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "ordenes_de_compra.crear": ["GERENTE", "ADMINISTRADOR"],
  "ordenes_de_compra.pedir": ["GERENTE", "ADMINISTRADOR"],
  "ordenes_de_compra.cerrar": ["GERENTE", "ADMINISTRADOR"],
  "ordenes_de_compra.anular": ["GERENTE", "ADMINISTRADOR"],
  // Devoluciones de mercadería al proveedor (N4): mirarlas es de los tres roles (como la orden); devolver y anular una devolución es de quien administra o gerencia. SUPUESTO a confirmar por el dueño (16/11/2026, DEC-0712).
  "devoluciones_a_proveedor.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "devoluciones_a_proveedor.registrar": ["GERENTE", "ADMINISTRADOR"],
  "devoluciones_a_proveedor.anular": ["GERENTE", "ADMINISTRADOR"],
  // Notas de crédito del proveedor (N4, comprobante sin saldo): cargarlas y anularlas es de quien administra o gerencia; verlas, de los tres roles. SUPUESTO a confirmar por el dueño (16/11/2026, DEC-0713).
  "notas_de_credito_de_proveedor.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "notas_de_debito_de_proveedor.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "notas_de_credito_de_proveedor.registrar": ["GERENTE", "ADMINISTRADOR"],
  "notas_de_debito_de_proveedor.registrar": ["GERENTE", "ADMINISTRADOR"],
  "notas_de_credito_de_proveedor.anular": ["GERENTE", "ADMINISTRADOR"],
  "notas_de_debito_de_proveedor.anular": ["GERENTE", "ADMINISTRADOR"],
  // Diferencias de la conciliación de tres vías (N4): verlas y resolverlas es de quien administra o gerencia. SUPUESTO a confirmar por el dueño (16/11/2026, DEC-0710).
  "diferencias_de_compra.ver": ["GERENTE", "ADMINISTRADOR"],
  "diferencias_de_compra.resolver": ["GERENTE", "ADMINISTRADOR"],
  "compras.configurar": ["GERENTE"],
  "compras.corregir": ["GERENTE", "ADMINISTRADOR"],
  // Exportar compras a Excel (dueño, 25/11/2026, pregunta 4): quien administra o gerencia, y además `costos.ver` (la consulta exige las dos; el archivo lleva importes).
  "compras.exportar": ["GERENTE", "ADMINISTRADOR"],
} as const satisfies Record<
  keyof (typeof CATALOGO_DE_MODULOS)["compras"]["acciones"],
  readonly RolDeEmpresa[]
>;
