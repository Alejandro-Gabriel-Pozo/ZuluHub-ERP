import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { TipoDeComprobante } from "../dominio/comprobante-emitido";
import type {
  Concepto,
  ComprobanteAsociado,
  PeriodoDeServicio,
} from "../dominio/comprobante-nuevo";
import type {
  ResultadoDeAutorizacionArca,
  ResultadoDeConsulta,
} from "../dominio/estados-de-comprobante";
import type { PuntoDeVentaDeArca } from "../dominio/habilitacion-en-arca";
import type { SolicitudId } from "../dominio/identificadores";
import type { ImportesParaArca } from "../dominio/importes-para-arca";
import type { Receptor } from "../dominio/receptor";

/**
 * Puerto de emisión electrónica (spec H7 facturación §B.5.2): lo único que la numeración y la
 * validación necesitan saber del servicio de ARCA. Un adaptador por (emisor, ambiente); lo arma la
 * composición. Lo implementan el adaptador REAL (WSAA + WSFE v4.8, `src/adaptadores/arca/adaptador-arca.ts`)
 * y, en pruebas, el FALSO (`test/utilidades/emision-falsa.ts`).
 *
 * Los códigos de ARCA viajan CRUDOS (`Mensaje.codigo`): traducirlos a texto para la persona es de la
 * pantalla. Toda llamada se hace FUERA de una transacción (ADR-007): el reintento serializable la
 * repetiría.
 */
export type PuntoDeVentaParaEmision = Readonly<{ cuit: Cuit; numero: number }>;

/**
 * Lo que `FECAESolicitar` necesita de un comprobante, ya calculado: el contenido es el del comprobante
 * (inmutable), el número y la fecha son los que se fijaron al reservar. `servicio` es el período del
 * abono (conceptos 2 y 3); `asociado` va solo en las notas.
 */
export type SolicitudDeAutorizacion = Readonly<{
  puntoDeVenta: PuntoDeVentaParaEmision;
  tipo: TipoDeComprobante;
  /** El número reservado en la serie (`numeroEnCurso`). */
  numero: bigint;
  /** La solicitud que lo reservó: identifica el pedido ante reintentos. */
  solicitud: SolicitudId;
  /** La fecha del comprobante (`CbteFch`), fijada al reservar el número. */
  fecha: FechaCivil;
  concepto: Concepto;
  servicio: PeriodoDeServicio | null;
  receptor: Pick<Receptor, "documento" | "condicionIva">;
  importes: ImportesParaArca;
  asociado: ComprobanteAsociado | null;
}>;

/**
 * El servicio no se pudo consultar, o no hay con qué consultarlo. No es un rechazo de un comprobante.
 * `SIN_CREDENCIAL`: no hay credencial de acceso (TA) ni certificado vigente; `AUTORIZACION_DEL_SERVICIO_FALTANTE`:
 * el certificado no está autorizado para el servicio (WSAA `coe.notAuthorized`); `ACCESO_YA_EMITIDO`: ya hay
 * una credencial de acceso vigente y ARCA no emite otra (WSAA `coe.alreadyAuthenticated`).
 */
export type ErrorDeEmision = Readonly<{
  codigo:
    | "SERVICIO_NO_DISPONIBLE"
    | "SIN_CREDENCIAL"
    | "AUTORIZACION_DEL_SERVICIO_FALTANTE"
    | "ACCESO_YA_EMITIDO";
  detalle: string;
}>;

export interface EmisionElectronica {
  /** El último número que el servicio tiene autorizado para ese punto de venta y tipo. */
  ultimoAutorizado(
    puntoDeVenta: PuntoDeVentaParaEmision,
    tipo: TipoDeComprobante,
  ): Promise<Resultado<bigint, ErrorDeEmision>>;
  /**
   * Pide autorizar el número reservado. `INCIERTO` si no se sabe qué pasó (se resuelve consultando,
   * nunca reenviando); `NO_ENVIADO` si es seguro que ARCA no lo procesó (el número se libera).
   */
  autorizar(solicitud: SolicitudDeAutorizacion): Promise<ResultadoDeAutorizacionArca>;
  /**
   * Lo que ARCA tiene registrado de ese número (`FECompConsultar`). `NO_ENCONTRADO` solo ante el código
   * 602 inequívoco; cualquier otra falla es `CONSULTA_FALLIDA` (no se sabe, se reintenta).
   */
  consultar(
    puntoDeVenta: PuntoDeVentaParaEmision,
    tipo: TipoDeComprobante,
    numero: bigint,
  ): Promise<ResultadoDeConsulta>;
  /**
   * Los puntos de venta que ARCA tiene registrados para la CUIT del emisor (`FEParamGetPtosVenta`, D-77). Una lectura: se puede repetir. Sin
   * puntos de venta es una lista vacía (no un error); cualquier respuesta que no se entienda es `SERVICIO_NO_DISPONIBLE`.
   */
  puntosDeVenta(cuit: Cuit): Promise<Resultado<readonly PuntoDeVentaDeArca[], ErrorDeEmision>>;
}
