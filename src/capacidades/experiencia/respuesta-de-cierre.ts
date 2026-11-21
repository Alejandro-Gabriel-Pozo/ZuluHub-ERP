import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * Los códigos públicos de negocio del cierre del día (ADR-016): lo ÚNICO que sale hacia la pantalla cuando una acción o una lectura del cierre no puede completarse por una regla
 * del negocio, y los dos avisos que Caja y Venta dan cuando el día ya se está cerrando o está cerrado. Tienen texto aprobado (DDD:123, 14/11/2026: «los seis avisos sin texto del
 * cierre usan el genérico»; y los dos de `caja.html`, decisión 175, aprobados por defecto el 20/11/2026, fila 388):
 *  - `CIERRE_CONTROLES_CAMBIARON`: «Cambió algo mientras mirabas. Revisá y volvé a cerrar» (único aviso propio de la pantalla del cierre; vuelve a leer los controles);
 *  - `CIERRE_ACCION_NO_PERMITIDA`: el genérico «Esta acción no está permitida» (`cierre.error.accion_no_permitida`; el mismo texto aprobado que el de caja, con la clave de su módulo);
 *  - `CIERRE_DIA_EN_CIERRE` y `CIERRE_DIA_CERRADO` (`JORNADA_EN_AUDITORIA` y `JORNADA_CERRADA` al abrir caja, cobrar o vender): «El día está en cierre. Cancelá el cierre para seguir» y
 *    «El día ya está cerrado». Un solo lugar para la correspondencia: `CODIGO_DE_JORNADA`; la usan los traductores de caja, de cobrar y de ventas.
 * Cómo se llega de un error del cierre, de caja, de ventas o de identidad a uno de estos lo decide `src/composicion/errores-de-cierre.ts` (tabla exhaustiva por tipo): un
 * error que ninguna tabla conoce no sale crudo, sale como inesperado con su referencia.
 *
 * Previene: que un error del cierre sin traducir se muestre crudo o que se invente un texto por cada regla (ficha de pantalla, decisión 175: «mensaje genérico antes que
 * uno por acción»). Chequeo: `respuesta.test.ts` (todo código tiene su texto) y `errores-de-cierre.test.ts` (todo error de los casos de uso y las consultas se traduce).
 */
export const CLAVES_DE_ERRORES_DE_CIERRE = {
  CIERRE_CONTROLES_CAMBIARON: "cierre.error.controles_cambiaron",
  CIERRE_ACCION_NO_PERMITIDA: "cierre.error.accion_no_permitida",
  CIERRE_DIA_EN_CIERRE: "cierre.error.en_cierre",
  CIERRE_DIA_CERRADO: "cierre.error.cerrada",
} as const satisfies Record<string, ClaveDeTexto>;

export type CodigoDeCierre = keyof typeof CLAVES_DE_ERRORES_DE_CIERRE;

/** De un error de jornada de los módulos que operan sobre ella (caja, cobrar, ventas) al aviso del día: en cierre o cerrado. */
export const CODIGO_DE_JORNADA = {
  JORNADA_EN_AUDITORIA: "CIERRE_DIA_EN_CIERRE",
  JORNADA_CERRADA: "CIERRE_DIA_CERRADO",
} as const satisfies Record<string, CodigoDeCierre>;

/** El aviso del día para un error de jornada con nombre (`JORNADA_EN_AUDITORIA`, `JORNADA_CERRADA`); `null` para cualquier otro error. */
export function codigoDeJornada(error: unknown): CodigoDeCierre | null {
  return typeof error === "string" && Object.hasOwn(CODIGO_DE_JORNADA, error)
    ? CODIGO_DE_JORNADA[error as keyof typeof CODIGO_DE_JORNADA]
    : null;
}
