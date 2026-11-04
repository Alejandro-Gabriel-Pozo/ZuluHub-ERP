import { qrDeFacturaComoSvg } from "../adaptadores/qr/qr-de-factura";
import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { ModeloImpreso } from "../modulos/fiscal/publico";
import { accionDeWeb } from "./accion-de-web";
import { entradaDeVerComprobante } from "./entradas-de-facturacion";
import type { DependenciasDeFacturacionWeb } from "./facturacion-web";

/**
 * El modelo de impresión que recibe la ruta de la vista imprimible (H7 facturación §B.7). Vive aparte de `facturacion-web.ts` (que está
 * en el tope de tamaño, como `lecturas-para-emitir-web.ts`) y sigue sus mismas reglas: el `contexto` lo resuelve el servidor, la consulta
 * exige `comprobantes.ver` al guard dentro de su transacción (acá no se decide ningún permiso) y todo sale por `aRespuestaFiscal`.
 */

/**
 * Lo que recibe la ruta de impresión: el modelo TAL COMO LO ARMÓ el dominio (un valor puro, sin ids ni claves: importes y fechas como
 * texto) y el QR ya dibujado, para que `apps/web` no importe el adaptador de QR (regla de arquitectura). `qrSvg` es solo formas
 * (`<svg>` con `<rect>` y `<path>`, sin texto ni etiqueta: la etiqueta la pone quien lo inserta) y sale del MISMO `modelo.qr.url`.
 */
export type ModeloDeImpresionParaLaPantalla = Readonly<{
  modelo: ModeloImpreso;
  qrSvg: string;
}>;

/**
 * El modelo de impresión de un comprobante AUTORIZADO de la empresa (`comprobantes.ver`), con el QR dibujado. Es una LECTURA: no escribe
 * ni audita, y pedirla de nuevo da lo mismo (la versión de representación la sella el comprobante al nacer). `crudo` solo aporta el id
 * del comprobante (la misma forma que ver su detalle: la empresa y cualquier versión que traiga el pedido se descartan). La consulta
 * valida dentro de su transacción el permiso, el módulo, la empresa y el alcance de sucursal del comprobante (D-39: el que no corresponde
 * se dice igual que el que no existe). Falla cerrado: no sale el modelo a medias. Si el QR no se puede dibujar, la marca no está cableada
 * o el comprobante no se puede imprimir (no autorizado, versión que no se sabe dibujar, CAE inválido), sale el error del camino común: los
 * del negocio con su código y los demás como inesperado con su referencia `PD-…`, sin texto nuevo.
 */
export function verModeloDeImpresion(
  d: DependenciasDeFacturacionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<ModeloDeImpresionParaLaPantalla>> {
  return accionDeWeb(
    d.respuesta,
    crudo,
    entradaDeVerComprobante,
    (entrada) => d.consultas().modeloDeImpresion(contexto, entrada),
    (modelo) => ({ modelo, qrSvg: qrDeFacturaComoSvg(modelo.qr.url) }),
  );
}
