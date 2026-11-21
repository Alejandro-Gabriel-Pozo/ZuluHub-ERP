import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * Los códigos públicos de negocio de la pantalla «Cierre del día» (ADR-016): lo ÚNICO que sale hacia la pantalla cuando una acción o una lectura del cierre no puede
 * completarse por una regla del negocio. Hay DOS, y solo dos tienen texto aprobado (DDD:123, 14/11/2026: «los seis avisos sin texto del cierre usan el genérico»):
 *  - `CIERRE_CONTROLES_CAMBIARON`: «Cambió algo mientras mirabas. Revisá y volvé a cerrar» (único aviso propio del cierre; la pantalla vuelve a leer los controles);
 *  - `CIERRE_ACCION_NO_PERMITIDA`: el genérico «Esta acción no está permitida» (`cierre.error.accion_no_permitida`; el mismo texto aprobado que el de caja, con la clave de su módulo).
 * Cómo se llega de un error del cierre, de caja, de ventas o de identidad a uno de estos lo decide `src/composicion/errores-de-cierre.ts` (tabla exhaustiva por tipo): un
 * error que ninguna tabla conoce no sale crudo, sale como inesperado con su referencia.
 *
 * Previene: que un error del cierre sin traducir se muestre crudo o que se invente un texto por cada regla (ficha de pantalla, decisión 175: «mensaje genérico antes que
 * uno por acción»). Chequeo: `respuesta.test.ts` (todo código tiene su texto) y `errores-de-cierre.test.ts` (todo error de los casos de uso y las consultas se traduce).
 */
export const CLAVES_DE_ERRORES_DE_CIERRE = {
  CIERRE_CONTROLES_CAMBIARON: "cierre.error.controles_cambiaron",
  CIERRE_ACCION_NO_PERMITIDA: "cierre.error.accion_no_permitida",
} as const satisfies Record<string, ClaveDeTexto>;

export type CodigoDeCierre = keyof typeof CLAVES_DE_ERRORES_DE_CIERRE;
