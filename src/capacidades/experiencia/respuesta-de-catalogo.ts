import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * Los códigos públicos de negocio de la ficha de datos de un producto (ADR-016; A1, T2a): lo ÚNICO que sale hacia la pantalla cuando guardar los datos de un producto no
 * se puede por una regla del negocio. Cada uno tiene su texto en el catálogo (`catalogo.error.*`), que ya está aprobado en la fila «Errores» de «Textos nuevos» de la maqueta
 * `productos.html` (09/11/2026), con una excepción: «Esta acción no está permitida» es el genérico (ya aprobado en esa misma maqueta). Cómo se llega de un error del módulo a
 * uno de estos lo decide `src/composicion/errores-de-catalogo.ts`.
 *
 * Previene: que un error del catálogo sin traducir salga como «inesperado» (con referencia, como si fuera un defecto) o que se invente un texto por cada regla del dominio.
 * Chequeo: `respuesta-de-catalogo.test.ts` (cada código con su texto exacto) y `respuesta.test.ts` (todo código tiene su texto).
 */
export const CLAVES_DE_ERRORES_DE_CATALOGO = {
  CATALOGO_NOMBRE_REPETIDO: "catalogo.error.nombre_repetido",
  CATALOGO_CODIGO_REPETIDO: "catalogo.error.codigo_repetido",
  CATALOGO_CODIGO_DE_BARRAS_INVALIDO: "catalogo.error.codigo_de_barras_invalido",
  CATALOGO_ELEGI_LA_ALICUOTA: "catalogo.error.elegi_la_alicuota",
  CATALOGO_FALTA_EL_NOMBRE: "catalogo.error.falta_el_nombre",
  CATALOGO_ACCION_NO_PERMITIDA: "catalogo.error.accion_no_permitida",
} as const satisfies Record<string, ClaveDeTexto>;

export type CodigoDeCatalogo = keyof typeof CLAVES_DE_ERRORES_DE_CATALOGO;
