import { CODIGOS_PUBLICOS } from "../capacidades/experiencia/respuesta";
import type { CodigoDeProduccion } from "../capacidades/experiencia/respuesta-de-produccion";
import type { CodigoDeStock } from "../capacidades/experiencia/respuesta-de-stock";

/**
 * De un error de producción al código público que sale a la pantalla (ADR-016; pantallas de órdenes). Lista de permitidos: ningún error de la orden tiene texto aprobado
 * (`ORDEN_YA_CERRADA`, `ORDEN_CANCELADA`, `ORDEN_ANULADA`, `ORDEN_NO_CERRADA`, `PRODUCTO_YA_USADO`, `MOTIVO_REQUERIDO`…) ni los de stock que cruzan (`CONTROL_BLOQUEA`, lotes,
 * depósitos…), así que TODO error de negocio del módulo, con forma de texto o de objeto con `error`, sale como el genérico «Esta acción no está permitida» (E6 §10, D175; dueño,
 * 30/10/2026, interfaz sobria: genérico antes que uno por acción). Excepciones: el vencimiento que falta o ya pasó al cerrar (con su texto de Lotes) y abrir con faltante en el nivel AVISAR (`CONTROL_REQUIERE_CONFIRMACION`) sale como el aviso `STOCK_CONTROL_AVISA` (pide confirmar, no es un fallo). Pasan SIN CAMBIOS los códigos que ya son públicos (los motivos del guard, la sesión, la empresa que no opera,
 * que trae `codigo`) y `ERROR_DE_LA_BASE_NO_TRADUCIDO`, que es un defecto y sale como inesperado, con referencia. Un error nuevo del módulo, conocido o no, cierra en el genérico.
 * Previene: que un error de producción salga como un fallo inesperado, que un texto sin aprobar llegue a la pantalla o que un defecto de la base se disfrace de «no permitido».
 * Chequeo: `errores-de-produccion.test.ts`.
 */

/** Un defecto: la base devolvió una restricción que el módulo no sabe traducir. No es de negocio. */
const DEFECTO_DE_LA_BASE = "ERROR_DE_LA_BASE_NO_TRADUCIDO";

const GENERICO = { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" satisfies CodigoDeProduccion } as const;

/** Los dos errores de la fecha de vencimiento al cerrar una orden tienen texto aprobado (Lotes): salen con él y no como el genérico. */
const ERROR_DE_VENCIMIENTO = {
  VENCIMIENTO_REQUERIDO: "LOTE_VENCIMIENTO_REQUERIDO",
  VENCIMIENTO_PASADO: "PRODUCCION_VENCIMIENTO_PASADO",
} as const satisfies Readonly<Record<string, CodigoDeProduccion | CodigoDeStock>>;

/** El aviso «va a quedar en negativo» (nivel AVISAR) que devuelve abrir una orden con faltante: no es un fallo, la pantalla pide confirmar («Producir igual») y reintenta con la misma clave. */
const AVISO_DE_NEGATIVO = "STOCK_CONTROL_AVISA" satisfies CodigoDeStock;

/** El error de un caso de uso o consulta de producción tal como lo entiende `aRespuesta`. */
export function traducirErrorDeProduccion(error: unknown): unknown {
  if (typeof error === "string") {
    if (Object.hasOwn(ERROR_DE_VENCIMIENTO, error)) {
      return ERROR_DE_VENCIMIENTO[error as keyof typeof ERROR_DE_VENCIMIENTO];
    }
    return Object.hasOwn(CODIGOS_PUBLICOS, error) || error === DEFECTO_DE_LA_BASE
      ? error
      : GENERICO;
  }
  // Un error de negocio con forma de objeto (`{ error: "CONTROL_BLOQUEA", … }`, `{ error: "FUNCION_NO_INCLUIDA", perilla }`): también el genérico. La base trae `tipo`, no `error`.
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { error?: unknown }).error === "string"
  ) {
    return (error as { error: string }).error === "CONTROL_REQUIERE_CONFIRMACION"
      ? AVISO_DE_NEGATIVO
      : GENERICO;
  }
  return error;
}
