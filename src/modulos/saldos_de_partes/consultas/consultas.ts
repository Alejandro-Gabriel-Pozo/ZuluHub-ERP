import type { ContextoOperativo } from "../../../contexto/contexto";
import type { Importe } from "../../../primitivas/dinero/importe";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { TxDeSaldos } from "../casos-de-uso/contrato";
import type {
  CargoPendiente,
  LineaDeCuenta,
  PartidaAbierta,
  Reparto,
  Sentido,
} from "../persistencia/repositorio-de-saldos";

/**
 * Las consultas del libro de saldos. Leen DENTRO de la transacción (o la conexión) del llamador, que ya autorizó: el libro no autoriza. Todas
 * filtran por la empresa del contexto; una parte de otra empresa es, para el que pregunta, una parte sin movimientos (saldo cero, listas vacías):
 * no hay forma de saber si existe. Los importes son `ARS` en centavos exactos. No importan el dominio (ADR-005): leen y devuelven objetos planos.
 */
export type LecturaDeSaldos = Pick<TxDeSaldos, "saldos">;

/** El saldo de la parte en ese sentido: positivo = se debe; negativo = saldo a favor; cero si nunca tuvo asientos. */
export function saldoDeParte(
  lectura: LecturaDeSaldos,
  contexto: ContextoOperativo,
  parteId: string,
  sentido: Sentido,
): Promise<Importe> {
  return lectura.saldos.saldoDeParte(contexto.empresaId, parteId, sentido);
}

/** El desglose del saldo por centro de costo (sucursal ascendente, «sin centro» al final). Su suma es EXACTAMENTE `saldoDeParte`. */
export function saldoPorCentroDeCosto(
  lectura: LecturaDeSaldos,
  contexto: ContextoOperativo,
  parteId: string,
  sentido: Sentido,
): Promise<Reparto[]> {
  return lectura.saldos.saldoPorCentroDeCosto(contexto.empresaId, parteId, sentido);
}

/**
 * Los asientos de la parte con su signo y el saldo corrido, del primero al último. `desde` y `hasta` (fecha de negocio, inclusive) recortan las
 * líneas pero no el saldo corrido: cada línea muestra el saldo real a ese momento.
 */
export function estadoDeCuenta(
  lectura: LecturaDeSaldos,
  contexto: ContextoOperativo,
  parteId: string,
  sentido: Sentido,
  desde?: FechaCivil,
  hasta?: FechaCivil,
): Promise<LineaDeCuenta[]> {
  return lectura.saldos.estadoDeCuenta(
    contexto.empresaId,
    parteId,
    sentido,
    desde ?? null,
    hasta ?? null,
  );
}

/** Los cargos con algo pendiente, por vencimiento (los que no vencen, al final) y antigüedad, cada uno con su «vencida» a la fecha `hoy`. */
export function cargosAbiertos(
  lectura: LecturaDeSaldos,
  contexto: ContextoOperativo,
  parteId: string,
  sentido: Sentido,
  hoy: FechaCivil,
): Promise<CargoPendiente[]> {
  return lectura.saldos.cargosAbiertos(contexto.empresaId, parteId, sentido, hoy);
}

/** Los saldos a favor (notas de crédito, pagos a cuenta) con algo por aplicar, y lo que les queda. */
export function creditosAbiertos(
  lectura: LecturaDeSaldos,
  contexto: ContextoOperativo,
  parteId: string,
  sentido: Sentido,
): Promise<PartidaAbierta[]> {
  return lectura.saldos.creditosAbiertos(contexto.empresaId, parteId, sentido);
}
