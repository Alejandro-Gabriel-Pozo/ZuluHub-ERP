import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { TicketId } from "../dominio/identificadores";
import type { DocumentoDeTicket } from "../persistencia/repositorio-de-documentos";
import type { DependenciasDeVentas, TxDeVentas } from "./contrato";
import type { ErrorDeVentas } from "./errores";

/**
 * Lo que fiscal dice de los documentos de un ticket. `documentos` son todos los del ticket (del primer intento al último); `vigente` es el
 * documento que HOY vale (con su comprobante) y `caido` el que el puntero daba por vigente pero fiscal ya no (rechazado, descartado o
 * acreditado por completo): quien emite lo marca no vigente; quien anula lo ignora.
 */
export type ComprobanteDelTicket = Readonly<{
  documentos: readonly DocumentoDeTicket[];
  vigente: Readonly<{ documentoId: string; comprobanteId: string }> | null;
  caido: DocumentoDeTicket | null;
}>;

/**
 * UNA sola pregunta «¿este ticket tiene un comprobante vigente?», la de `emitirComprobanteDeTicket` (`TICKET_YA_FACTURADO`) y la de
 * `anularTicket` (`TICKET_CON_COMPROBANTE_VIGENTE`): «facturado» lo decide siempre fiscal, no el puntero, y «Confirmando» cuenta como
 * vigente. Previene que las dos reglas se separen (anular un ticket que emitir da por facturado). Se llama DENTRO de la transacción que ya
 * tiene el ticket tomado `FOR UPDATE` (`tx.documentos.bloquearTicket`): sin esa fila tomada, otra transacción puede facturar entre medio.
 * Con facturación por partes (0..N comprobantes vigentes) el cambio es esta línea: `documentos.find((d) => d.vigente)` pasa a filtrar todos
 * los vigentes y `vigente` a «alguno vale».
 * Sin documento vigente no se necesita facturador; con uno y sin facturador cableado falla cerrado (`FACTURACION_NO_DISPONIBLE`).
 */
export async function consultarComprobanteDelTicket(
  tx: TxDeVentas,
  dependencias: DependenciasDeVentas,
  contexto: ContextoOperativo,
  ticket: TicketId,
): Promise<Resultado<ComprobanteDelTicket, ErrorDeVentas>> {
  const documentos = await tx.documentos.delTicket(contexto.empresaId, ticket);
  const delPuntero = documentos.find((d) => d.vigente);
  if (delPuntero === undefined) return ok({ documentos, vigente: null, caido: null });
  const facturador = dependencias.facturador;
  if (facturador === undefined) return err("FACTURACION_NO_DISPONIBLE");
  const vigencia = await facturador.vigenciaEnTx(tx, contexto, [delPuntero.comprobanteId]);
  if (!vigencia.ok) return err({ error: "FACTURACION_FALLIDA", causa: vigencia.error });
  const estado = vigencia.valor.find((v) => v.comprobanteId === delPuntero.comprobanteId);
  // El puntero es una clave foránea hacia fiscal: un comprobante que fiscal no reconoce es una inconsistencia grave, no un caso de negocio.
  if (estado === undefined) {
    throw new Error(
      `el comprobante ${delPuntero.comprobanteId} del ticket ${ticket} no figura en fiscal`,
    );
  }
  return estado.vigente
    ? ok({
        documentos,
        vigente: { documentoId: delPuntero.id, comprobanteId: delPuntero.comprobanteId },
        caido: null,
      })
    : ok({ documentos, vigente: null, caido: delPuntero });
}
