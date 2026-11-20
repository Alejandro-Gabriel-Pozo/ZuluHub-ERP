import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * Los códigos públicos de negocio de ventas (ADR-016): lo ÚNICO que sale hacia la pantalla cuando una consulta o un caso de uso del mostrador no puede completarse por una regla del
 * negocio. Hay DOS: el genérico «Esta acción no está permitida» (aprobado por el dueño el 30/10/2026, «Interfaz sobria»: mensaje genérico antes que uno por acción; mismo texto que
 * `caja.error.accion_no_permitida`) y «Primero acreditá la factura con una nota de crédito» (anular un ticket con factura vigente; DDD:171 c, DEC-0782). Ningún otro texto específico de ventas está aprobado: no se inventa uno por error. Cómo se llega de
 * un error del módulo a este código lo decide `src/composicion/errores-de-ventas.ts` (lista de permitidos). Previene: que un error de ventas salga crudo a la pantalla o que se invente un
 * texto por cada regla del dominio. Chequeo: `respuesta-de-ventas.test.ts` (el código tiene su texto) y `errores-de-ventas.test.ts`.
 */
export const CLAVES_DE_ERRORES_DE_VENTAS = {
  VENTAS_ACCION_NO_PERMITIDA: "ventas.error.accion_no_permitida",
  VENTAS_TICKET_CON_FACTURA_VIGENTE: "ventas.error.ticket_con_factura_vigente",
} as const satisfies Record<string, ClaveDeTexto>;

export type CodigoDeVentas = keyof typeof CLAVES_DE_ERRORES_DE_VENTAS;
