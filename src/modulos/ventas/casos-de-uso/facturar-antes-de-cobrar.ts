import { exigirPerilla } from "../../../capacidades/planes/derechos";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { LecturaDeDerechosDeUso } from "../../../puertos/derechos-de-uso";
import type { EstadoDeTicket } from "../dominio/estados";

/**
 * Qué estados de ticket se pueden facturar (R-05, decisión del dueño del 14/11/2026): un ticket COBRADO siempre; uno EMITIDO (sin cobrar) solo si la empresa
 * enciende la perilla `facturar_antes_de_cobrar`. Un ticket ANULADO o de CORTESÍA nunca (invariante: también lo impide el disparador `documento_validar_alta`
 * de la base). Es la ÚNICA regla: la emisión, la ficha y la lista de pendientes la usan. Previene: que una pantalla ofrezca lo que la emisión rechaza.
 */
export function estadosFacturables(antesDeCobrar: boolean): readonly EstadoDeTicket[] {
  return antesDeCobrar ? ["EMITIDO", "COBRADO"] : ["COBRADO"];
}

export function ticketSeFactura(estado: EstadoDeTicket, antesDeCobrar: boolean): boolean {
  return estadosFacturables(antesDeCobrar).includes(estado);
}

/**
 * ¿La empresa puede facturar un ticket sin cobrar? (R-05): el valor de la perilla `facturar_antes_de_cobrar` del plan y los ajustes vigentes, leído en
 * la transacción en curso y sin caché (apagarla rige en la acción siguiente). Es la ÚNICA lectura de esta perilla en ventas: la emisión, la ficha del
 * ticket, `ticketParaFacturar` y los pendientes de facturar deciden con `ticketSeFactura(estado, esta respuesta)`. Falla cerrado: si la perilla no está
 * encendida, es `false`.
 */
export async function facturarAntesDeCobrarEncendida(
  tx: Readonly<{ derechos: Pick<LecturaDeDerechosDeUso, "deLaEmpresa"> }>,
  contexto: ContextoOperativo,
): Promise<boolean> {
  const derechos = await tx.derechos.deLaEmpresa(contexto);
  return exigirPerilla(derechos, "facturar_antes_de_cobrar", { empresaId: contexto.empresaId }).ok;
}
