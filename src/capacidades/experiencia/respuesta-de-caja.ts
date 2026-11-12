import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * Los códigos públicos de negocio de la configuración de caja (ADR-016): lo ÚNICO que sale hacia la pantalla cuando un caso de uso de medios de
 * pago no puede completarse por una regla del negocio. Cada uno tiene su texto en el catálogo (`caja.error.*`, fuente en `catalogo-caja.ts`). Cómo
 * se llega de un error del módulo a uno de estos lo decide `src/composicion/errores-de-caja.ts` (tabla exhaustiva por tipo).
 *
 * Previene: que un error de caja sin traducir se muestre crudo o se vuelva un genérico que esconde qué corregir. Chequeo: `respuesta.test.ts`
 * (todo código tiene su texto) y `errores-de-caja.test.ts` (todo error del módulo se traduce).
 */
export const CLAVES_DE_ERRORES_DE_CAJA = {
  CAJA_MEDIO_REPETIDO: "caja.error.medio_repetido",
  CAJA_CUENTA_REPETIDA: "caja.error.cuenta_repetida",
  CAJA_CAJA_REPETIDA: "caja.error.caja_repetida",
  CAJA_IDENTIFICADOR_INVALIDO: "caja.error.identificador_invalido",
  CAJA_ACCION_NO_PERMITIDA: "caja.error.accion_no_permitida",
} as const satisfies Record<string, ClaveDeTexto>;

export type CodigoDeCaja = keyof typeof CLAVES_DE_ERRORES_DE_CAJA;
