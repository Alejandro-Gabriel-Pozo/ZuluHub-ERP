import type { MotivoDeRechazo } from "../capacidades/permisos/guard";
import type {
  ErrorAlListarComprobantes,
  ErrorAlPedirElModeloDeImpresion,
  ErrorAlVerComprobante,
} from "../modulos/fiscal/publico";
import type { ErrorDePersistencia } from "../puertos/transacciones";

/**
 * Los errores de LEER comprobantes que la web recibe: el listado, el detalle y el modelo de impresión. Viven acá porque
 * `errores-fiscales.ts` está en el tope de tamaño (400 líneas) y los del modelo de impresión (h7 facturación §B.7) se suman a esos dos.
 */
export type ErrorAlLeerComprobantes =
  ErrorAlListarComprobantes | ErrorAlVerComprobante | ErrorAlPedirElModeloDeImpresion;

/**
 * Los tres errores propios del modelo de impresión: ninguno tiene texto nuevo (regla del dueño, 2026-10-30: mensaje genérico antes que
 * uno por acción), así que los tres salen como error inesperado con su referencia `PD-…` y el código solo en el registro del servidor.
 *  - `COMPROBANTE_NO_AUTORIZADO`: la pantalla solo ofrece imprimir un comprobante autorizado; pedir otro es un pedido armado a mano.
 *  - `VERSION_DE_REPRESENTACION_DESCONOCIDA`: la lista de versiones que se saben dibujar es cerrada (`modelo-de-impresion.ts`); la
 *    persona no puede corregir la versión que sellaron al emitir.
 *  - `CAE_INVALIDO`: un CAE sin 14 dígitos no tiene QR posible; tampoco lo corrige la persona.
 * Previene: que un error nuevo del modelo de impresión que nadie tradujo llegue crudo a la pantalla (la tabla es exhaustiva por tipo).
 * Chequeo: `errores-fiscales.test.ts` (la lista de defectos) y `modelo-de-impresion-web.test.ts`.
 */
export const ERRORES_DE_IMPRESION: Readonly<
  Record<
    Exclude<
      Extract<ErrorAlPedirElModeloDeImpresion, string>,
      Extract<ErrorAlVerComprobante | MotivoDeRechazo | ErrorDePersistencia, string>
    >,
    null
  >
> = {
  COMPROBANTE_NO_AUTORIZADO: null,
  VERSION_DE_REPRESENTACION_DESCONOCIDA: null,
  CAE_INVALIDO: null,
};
