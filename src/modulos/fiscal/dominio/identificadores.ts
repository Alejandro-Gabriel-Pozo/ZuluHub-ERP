import { esTextoDeIdentificador, type Marca } from "../../../primitivas/identificadores/marca";

// `EmisorId` vive en las primitivas (lo usan catálogo, stock y caja sin importar fiscal): acá se
// reexporta para que el resto de fiscal siga importándolo de su lugar de siempre.
export { emisorId, type EmisorId } from "../../../primitivas/identificadores/marca";

/**
 * Identificadores propios de lo fiscal. Viven acá y no en `primitivas/identificadores` para no
 * chocar con los otros frentes que tocan ese archivo (spec H7 §B.1). Mismas reglas que los demás:
 * texto no vacío y sin blancos en los extremos.
 */
export type PuntoDeVentaId = Marca<string, "PuntoDeVentaId">;
export type DomicilioId = Marca<string, "DomicilioId">;
/** Una versión (de datos fiscales o de la regla del emisor). */
export type VersionId = Marca<string, "VersionId">;
/** La solicitud que reserva un número de comprobante: la clave de idempotencia de la reserva. */
export type SolicitudId = Marca<string, "SolicitudId">;
/** El identificador del origen de un comprobante, dentro de su tipo de origen. Lo da quien factura. */
export type OrigenId = Marca<string, "OrigenId">;

function crear<Id extends string>(nombre: string, valor: string): Id {
  if (!esTextoDeIdentificador(valor)) {
    throw new RangeError(`${nombre} inválido`);
  }
  return valor as Id;
}

export const puntoDeVentaId = (valor: string): PuntoDeVentaId =>
  crear<PuntoDeVentaId>("PuntoDeVentaId", valor);
export const domicilioId = (valor: string): DomicilioId => crear<DomicilioId>("DomicilioId", valor);
export const versionId = (valor: string): VersionId => crear<VersionId>("VersionId", valor);
export const solicitudId = (valor: string): SolicitudId => crear<SolicitudId>("SolicitudId", valor);
export const origenId = (valor: string): OrigenId => crear<OrigenId>("OrigenId", valor);
