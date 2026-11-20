import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * Los códigos públicos de negocio de la pantalla de Recetas (ADR-016; B9 de `recetas-pantalla.md` §6 y §8): lo ÚNICO que sale hacia la pantalla cuando guardar una receta no se puede por
 * una regla del negocio. Hay UNO solo, el genérico «Esta acción no está permitida» (`receta.error.accion_no_permitida`): ninguna regla de la receta tiene texto propio (interfaz sobria, dueño,
 * 30/10/2026). Cómo se llega de un error del módulo de stock a él lo decide `src/composicion/errores-de-recetas.ts` (lista de permitidos).
 *
 * Previene: que un error de la receta sin traducir salga como «inesperado» (con referencia, como si fuera un defecto) o que se invente un texto por cada regla del dominio.
 * Chequeo: `respuesta-de-recetas.test.ts` (el código con su texto exacto) y `respuesta.test.ts` (todo código tiene su texto).
 */
export const CLAVES_DE_ERRORES_DE_RECETAS = {
  RECETA_ACCION_NO_PERMITIDA: "receta.error.accion_no_permitida",
} as const satisfies Record<string, ClaveDeTexto>;

export type CodigoDeReceta = keyof typeof CLAVES_DE_ERRORES_DE_RECETAS;
