import type { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import type { RolDeEmpresa } from "./roles";

export const PERMISOS_DE_FACTURACION = {
  // H7 (especificación §C): quien cobra puede emitir el comprobante en el mismo acto, los tres roles.
  "comprobantes.emitir": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  // H7 facturación §B.4.9 (F6): las consultas del facturador; mirar lo emitido lo pueden los tres roles.
  "comprobantes.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  // H7 facturación §C (F5). Emitir a mano (P10, DECIDIDO), la nota de crédito (P9, recomendada A), descartar y
  // reintentar (ASUMIDO): los tres roles. Resincronizar una serie (QF1) y cambiar el ambiente de un punto de venta
  // (QF2): solo el gerente (DECIDIDO, dueño 2026-10-13).
  "comprobantes.emitir_manual": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "notas_de_credito.emitir": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "comprobantes.descartar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "comprobantes.reintentar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "series.resincronizar": ["GERENTE"],
  "puntos_de_venta.cambiar_ambiente": ["GERENTE"],
  // H7 facturación §C (F7), DECIDIDO: solo el gerente genera el pedido y carga el certificado de ARCA.
  "certificados.gestionar": ["GERENTE"],
} as const satisfies Record<
  keyof (typeof CATALOGO_DE_MODULOS)["facturacion"]["acciones"],
  readonly RolDeEmpresa[]
>;
