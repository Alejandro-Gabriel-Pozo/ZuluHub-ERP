import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * Los códigos públicos de negocio de compras N1 y N2 (ADR-016): lo ÚNICO que sale hacia la pantalla cuando un caso de uso de compras no puede completarse por una regla
 * del negocio. Cada uno tiene su texto en el catálogo (`compras.error.*`, fuente en `catalogo-compras.ts`: `compra.html` y `orden.html`, aprobados el 09/11/2026); lo que esa
 * maqueta no redacta sale como el genérico «Esta acción no está permitida» (interfaz sobria, dueño 30/10/2026). Cómo se llega de un error del módulo a uno de estos lo decide
 * `src/composicion/errores-de-compras.ts` (tabla exhaustiva por tipo).
 *
 * Previene: que un error de compras sin traducir se muestre crudo o se vuelva un fallo inesperado que esconde qué corregir. Chequeo: `respuesta.test.ts` (todo código tiene su
 * texto) y `errores-de-compras.test.ts` (todo error del módulo se traduce).
 */
export const CLAVES_DE_ERRORES_DE_COMPRAS = {
  COMPRAS_REMITO_REPETIDO: "compras.error.remito_ya_registrado",
  COMPRAS_FACTURA_REPETIDA: "compras.error.comprobante_ya_registrado",
  COMPRAS_PUNTO_DE_VENTA_NO_DECLARADO: "compras.error.punto_de_venta_no_declarado",
  COMPRAS_CANTIDAD_INVALIDA: "compras.error.cantidad_invalida",
  COMPRAS_PRECIO_INVALIDO: "compras.error.precio_invalido",
  COMPRAS_PROVEEDOR_NO_ENCONTRADO: "compras.error.proveedor_no_encontrado",
  COMPRAS_NOTA_CON_PAGO: "compras.error.nota_con_pago",
  COMPRAS_ACCION_NO_PERMITIDA: "compras.error.sin_permiso",
} as const satisfies Record<string, ClaveDeTexto>;

export type CodigoDeCompras = keyof typeof CLAVES_DE_ERRORES_DE_COMPRAS;
