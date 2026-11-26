import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * Los códigos públicos de negocio de las pantallas de producción (ADR-016): lo ÚNICO que sale hacia la pantalla cuando cancelar o anular una orden no puede
 * completarse por una regla del negocio. El genérico «Esta acción no está permitida» (`lotes.error.sin_permiso`, ya aprobado) y, al cerrar una orden, los dos de la fecha de vencimiento (`lotes.error.vencimiento_*`, ya aprobados): para los demás errores
 * de la orden (`ORDEN_YA_CERRADA`, `ORDEN_CANCELADA`, `PRODUCTO_YA_USADO`…) no hay texto aprobado y la regla es genérico antes que uno por acción
 * (`CLAUDE.md`, «Interfaz sobria»; E6 §10, D175). Cómo se llega de un error del módulo a este lo decide `src/composicion/errores-de-produccion.ts`.
 *
 * Previene: que un error de producción sin texto aprobado salga crudo a la pantalla o que se invente un texto por cada regla de la orden. Chequeo:
 * `respuesta.test.ts` (todo código tiene su texto) y `errores-de-produccion.test.ts` (todo error del módulo se traduce).
 */
export const CLAVES_DE_ERRORES_DE_PRODUCCION = {
  PRODUCCION_ACCION_NO_PERMITIDA: "lotes.error.sin_permiso",
  // Cerrar una orden con un artículo que lleva control de vencimiento: la fecha falta o ya pasó (textos aprobados de Lotes, control.html fila «Recibir»).
  PRODUCCION_VENCIMIENTO_REQUERIDO: "lotes.error.vencimiento_requerido",
  PRODUCCION_VENCIMIENTO_PASADO: "lotes.error.vencimiento_pasado",
} as const satisfies Record<string, ClaveDeTexto>;

export type CodigoDeProduccion = keyof typeof CLAVES_DE_ERRORES_DE_PRODUCCION;
