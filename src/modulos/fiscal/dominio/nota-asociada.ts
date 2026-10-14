import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import {
  claseDeComprobante,
  letraDeComprobante,
  type InstantaneaDeEmisor,
  type TipoDeComprobante,
} from "./comprobante-emitido";
import {
  armarContenido,
  LIMITES_DE_COMPROBANTE,
  type Ambiente,
  type ComprobanteNuevo,
  type ContextoDeEmision,
  type EntradaDeComprobante,
  type ErrorDeComprobanteNuevo,
} from "./comprobante-nuevo";
import type { EstadoDeComprobanteArca } from "./estados-de-comprobante";
import type { EmisorId } from "./identificadores";
import type { Receptor } from "./receptor";

/**
 * Nota de crédito y nota de débito asociadas a un comprobante (spec H7 facturación §B.3.5).
 *
 * - El asociado debe estar `AUTORIZADO`, ser de la misma empresa, del MISMO EMISOR y del mismo
 *   ambiente, y de clase factura o nota de débito (ASUMIDO: una nota de crédito puede cancelar una
 *   de débito).
 * - La letra es la del asociado (no se recalcula: el emisor pudo cambiar de condición después de
 *   facturar) y el receptor es una COPIA del del asociado (una nota a otro receptor no corrige la
 *   factura).
 * - Los renglones los da quien emite; fiscal no decide si la nota es total o parcial. El importe
 *   siempre es positivo: la clase da el sentido. Una nota mayor que su asociado se permite (ARCA la
 *   aprueba con la observación 10237, que se muestra): es un control (ADR-008), no una regla.
 * - A ARCA se le informa el asociado (`CbtesAsoc`, error 10197).
 */

type BaseDelComprobanteAAsociar = Readonly<{
  empresaId: EmpresaId;
  emisorId: EmisorId;
  ambiente: Ambiente;
  tipo: TipoDeComprobante;
  /** El punto de venta y el CUIT salen de la instantánea del emisor, tal como se emitió. */
  emisor: Pick<InstantaneaDeEmisor, "cuit" | "puntoDeVentaNumero">;
  receptor: Receptor;
}>;

/** Lo que se lee del comprobante a asociar. Solo uno `AUTORIZADO` tiene número y fecha. */
export type ComprobanteAAsociar =
  | (BaseDelComprobanteAAsociar &
      Readonly<{
        estado: Exclude<EstadoDeComprobanteArca, "AUTORIZADO">;
      }>)
  | (BaseDelComprobanteAAsociar &
      Readonly<{ estado: "AUTORIZADO"; numero: bigint; fechaEmision: FechaCivil }>);

export type EntradaDeNota = Readonly<{
  clase: "NOTA_CREDITO" | "NOTA_DEBITO";
  /** Por qué se emite; opcional. */
  motivo: string | null;
}> &
  Omit<EntradaDeComprobante, "receptor">;

export type ErrorDeNota =
  | ErrorDeComprobanteNuevo
  | Readonly<{ codigo: "ASOCIADO_NO_AUTORIZADO" }>
  | Readonly<{ codigo: "ASOCIADO_DE_OTRA_EMPRESA" }>
  | Readonly<{ codigo: "ASOCIADO_DE_OTRO_EMISOR" }>
  | Readonly<{ codigo: "ASOCIADO_DE_OTRO_AMBIENTE" }>
  | Readonly<{ codigo: "ASOCIADO_NO_ASOCIABLE" }>
  | Readonly<{ codigo: "MOTIVO_INVALIDO" }>;

/**
 * Arma la nota. Devuelve el PRIMER error, en este orden: empresa, estado, emisor, ambiente y clase
 * del asociado; motivo; y después los de renglones, modo de precio, fechas y total.
 */
export function armarNotaAsociada(
  asociado: ComprobanteAAsociar,
  entrada: EntradaDeNota,
  contexto: ContextoDeEmision,
): Resultado<ComprobanteNuevo, ErrorDeNota> {
  if (asociado.empresaId !== contexto.empresaId) return err({ codigo: "ASOCIADO_DE_OTRA_EMPRESA" });
  if (asociado.estado !== "AUTORIZADO") return err({ codigo: "ASOCIADO_NO_AUTORIZADO" });
  if (asociado.emisorId !== contexto.emisorId) return err({ codigo: "ASOCIADO_DE_OTRO_EMISOR" });
  if (asociado.ambiente !== contexto.ambiente) return err({ codigo: "ASOCIADO_DE_OTRO_AMBIENTE" });
  if (claseDeComprobante(asociado.tipo) === "NOTA_CREDITO") {
    return err({ codigo: "ASOCIADO_NO_ASOCIABLE" });
  }
  const motivo = entrada.motivo?.trim() ?? "";
  if (motivo.length > LIMITES_DE_COMPROBANTE.motivo) return err({ codigo: "MOTIVO_INVALIDO" });
  return armarContenido({
    contexto,
    clase: entrada.clase,
    letra: letraDeComprobante(asociado.tipo),
    receptor: asociado.receptor,
    asociado: {
      tipo: asociado.tipo,
      puntoDeVenta: asociado.emisor.puntoDeVentaNumero,
      numero: asociado.numero,
      cuit: asociado.emisor.cuit,
      fecha: asociado.fechaEmision,
    },
    motivo: motivo === "" ? null : motivo,
    entrada,
  });
}
