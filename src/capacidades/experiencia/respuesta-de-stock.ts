import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * Los códigos públicos de negocio de las pantallas de stock (ADR-016): lo ÚNICO que sale hacia la pantalla cuando un caso de uso de stock no puede completarse por una regla
 * del negocio. Solo los errores que la maqueta aprobada `stock.html` (fila «Errores y avisos» de «Textos nuevos», 09/11/2026) redacta, más los tres de la gestión de depósitos que el dueño aprobó el 25/11/2026 (DEC-1018), tienen texto propio (`stock.error.*`); todo lo
 * demás sale con el genérico «Esta acción no está permitida» (`stock.error.sin_permiso`), como ya decidió el dueño. Cómo se llega de un error del módulo a uno de estos lo decide
 * `src/composicion/errores-de-stock.ts` (tabla exhaustiva por tipo). `STOCK_CONTROL_AVISA` y `STOCK_YA_HAY_EXISTENCIA` no son un fallo: la pantalla que los recibe pide confirmar y reintenta.
 *
 * Previene: que un error de stock sin traducir se muestre crudo o se vuelva un genérico que esconde qué corregir, y que se invente un texto por cada regla del dominio.
 * Chequeo: `respuesta-de-stock.test.ts` (cada código con su texto exacto), `respuesta.test.ts` (todo código tiene su texto) y `errores-de-stock.test.ts` (todo error del módulo se traduce).
 */
export const CLAVES_DE_ERRORES_DE_STOCK = {
  STOCK_CONTROL_AVISA: "stock.error.control_avisa",
  STOCK_YA_HAY_EXISTENCIA: "stock.carga.ya_hay_existencia",
  STOCK_TRANSFERENCIA_AL_MISMO_DEPOSITO: "stock.error.transferencia_al_mismo_deposito",
  STOCK_DETALLE_REQUERIDO: "stock.error.detalle_requerido",
  STOCK_CANTIDAD_INVALIDA: "stock.error.cantidad_invalida",
  STOCK_CONTEO_EN_CURSO: "stock.error.conteo_en_curso",
  STOCK_NOMBRE_DUPLICADO: "stock.error.nombre_duplicado",
  STOCK_DEPOSITO_CON_EXISTENCIA: "stock.error.deposito_con_existencia",
  STOCK_ES_EL_DE_VENTA: "stock.error.es_el_de_venta",
  STOCK_DEPOSITO_DESACTUALIZADO: "stock.error.deposito_desactualizado",
  STOCK_SALDO_DE_LOTE_INSUFICIENTE: "stock.error.saldo_de_lote_insuficiente",
  // Entrada con lotes (STK-E2a): la fecha de vencimiento falta (texto ya aprobado de Lotes, que también usa producción al cerrar una orden) o ya pasó (L-14).
  LOTE_VENCIMIENTO_REQUERIDO: "lotes.error.vencimiento_requerido",
  STOCK_VENCIMIENTO_PASADO: "stock.error.vencimiento_pasado",
  STOCK_ACCION_NO_PERMITIDA: "stock.error.sin_permiso",
} as const satisfies Record<string, ClaveDeTexto>;

export type CodigoDeStock = keyof typeof CLAVES_DE_ERRORES_DE_STOCK;
