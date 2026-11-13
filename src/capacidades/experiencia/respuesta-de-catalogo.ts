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
  // Precios (A1, T3): «Escribí un precio válido» está en la misma fila «Errores» de «Textos nuevos»; la frase del precio cambiado por otra persona la aprobó el dueño el 12/11/2026
  // (`decisiones-del-dueno-2026-11.md`, respuestas chicas, punto 5). Esta última lleva el importe vigente como parámetro (`PARAMETROS_DE_CATALOGO`).
  CATALOGO_PRECIO_INVALIDO: "catalogo.error.precio_invalido",
  CATALOGO_PRECIO_DESACTUALIZADO: "catalogo.precio.vigente_ahora",
  CATALOGO_ACCION_NO_PERMITIDA: "catalogo.error.accion_no_permitida",
} as const satisfies Record<string, ClaveDeTexto>;

export type CodigoDeCatalogo = keyof typeof CLAVES_DE_ERRORES_DE_CATALOGO;

/**
 * Los parámetros que un código del catálogo puede llevar hacia la pantalla (los marcadores de su texto): lista de permitidos por código; cualquier otro dato del error se descarta.
 * Previene: que el valor de un marcador viaje sin nombre de código o que un error arrastre datos internos. Chequeo: `respuesta-de-catalogo.test.ts` (coinciden con los marcadores del texto)
 * y `respuesta.test.ts` (se descartan los que no figuran y los que no son un decimal).
 */
export const PARAMETROS_DE_CATALOGO: Readonly<
  Partial<Record<CodigoDeCatalogo, readonly string[]>>
> = { CATALOGO_PRECIO_DESACTUALIZADO: ["importe"] };
