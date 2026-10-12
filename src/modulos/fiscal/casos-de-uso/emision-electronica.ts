import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { ResultadoDeAutorizacion, TipoDeComprobante } from "../dominio/comprobante-emitido";
import type { SolicitudId } from "../dominio/identificadores";

/**
 * Puerto de emisión electrónica (spec H7 §B.8): lo único que la numeración necesita saber del
 * servicio de ARCA. Un adaptador por punto de venta; lo elige la composición (después, la
 * plataforma lo habilita). En H7 solo existe el adaptador FALSO de pruebas
 * (`test/utilidades/emision-falsa.ts`): no se emite nada real.
 *
 * NO VERIFICADO: los nombres y datos del servicio de ARCA (`FECompUltimoAutorizado`, código de
 * autorización, consulta de un comprobante) salen de `diseno-inicial.md` §10 y ninguno está
 * contrastado con el manual del servicio. Este contrato es mínimo a propósito: la facturación lo
 * amplía cuando se verifique.
 *
 * La autorización se pide FUERA de la transacción (ADR-007): el reintento serializable la repetiría.
 */
export type PuntoDeVentaParaEmision = Readonly<{ cuit: Cuit; numero: number }>;

export type SolicitudDeAutorizacion = Readonly<{
  puntoDeVenta: PuntoDeVentaParaEmision;
  tipo: TipoDeComprobante;
  /** El número reservado en la serie (`numeroEnCurso`). */
  numero: bigint;
  /** La solicitud que lo reservó: identifica el pedido ante reintentos. */
  solicitud: SolicitudId;
}>;

/** El servicio no se pudo consultar (caído, sin conexión...). No es un rechazo de un comprobante. */
export type ErrorDeEmision = Readonly<{ codigo: "SERVICIO_NO_DISPONIBLE"; detalle: string }>;

export interface EmisionElectronica {
  /** El último número que el servicio tiene autorizado para ese punto de venta y tipo. */
  ultimoAutorizado(
    puntoDeVenta: PuntoDeVentaParaEmision,
    tipo: TipoDeComprobante,
  ): Promise<Resultado<bigint, ErrorDeEmision>>;
  /** Pide autorizar el número reservado. `INCIERTO` si no se sabe qué pasó (se reconcilia después). */
  autorizar(solicitud: SolicitudDeAutorizacion): Promise<ResultadoDeAutorizacion>;
}
