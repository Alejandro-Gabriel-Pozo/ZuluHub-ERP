import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDeAsignaciones } from "./errores";

/**
 * Asignación de sucursales a un miembro (H6, especificación §B.2). Dominio puro: sin reloj ni azar.
 * La asignación nunca se borra: se apaga y se vuelve a prender. Desactivar una sucursal no apaga las
 * asignaciones (la asignación efectiva es "asignación activa Y sucursal activa"), así que una
 * asignación activa puede apuntar a una sucursal desactivada.
 */

/** Lo que ya hay guardado de una persona: una fila por sucursal, activa o apagada. */
export type AsignacionActual = Readonly<{ sucursalId: SucursalId; activa: boolean }>;

/** Una sucursal de la empresa, activa o no (lo que `asignarSucursales` lee en la transacción). */
export type SucursalDeLaEmpresa = Readonly<{ id: SucursalId; activa: boolean }>;

/** Qué escribir, cada lista sin repetidos y ordenada por id (la auditoría compara antes y después). */
export type CambioDeAsignaciones = Readonly<{
  /** Sin fila todavía: se inserta. */
  agregadas: readonly SucursalId[];
  /** Con la fila apagada: se vuelve a prender. */
  reactivadas: readonly SucursalId[];
  /** Con la fila activa y fuera del conjunto pedido: se apaga. */
  quitadas: readonly SucursalId[];
}>;

/**
 * Calcula la diferencia entre lo asignado y el conjunto final pedido (`pedidas`; el orden y los
 * repetidos no importan, y vacío está permitido). Pedir lo que ya hay devuelve las tres listas vacías:
 * no se escribe ni se audita nada (idempotente). Gana el primer error que aplique:
 *
 * 1. Alguna pedida no está en `sucursales`: `SUCURSAL_NO_ES_DE_LA_EMPRESA`.
 * 2. Alguna pedida habría que agregarla o reactivarla y su sucursal está desactivada:
 *    `SUCURSAL_INACTIVA`. Conservar una asignación que ya está activa no escribe nada, así que no
 *    se rechaza aunque su sucursal se haya desactivado después (reenviar el mismo conjunto es ok).
 *
 * `actuales` trae a lo sumo una fila por sucursal.
 */
export function decidirAsignaciones(
  actuales: readonly AsignacionActual[],
  pedidas: readonly SucursalId[],
  sucursales: readonly SucursalDeLaEmpresa[],
): Resultado<CambioDeAsignaciones, ErrorDeAsignaciones> {
  const pedidasUnicas = new Set(pedidas);
  const activaPorSucursal = new Map(sucursales.map((s) => [s.id, s.activa]));
  const filaPorSucursal = new Map(actuales.map((a) => [a.sucursalId, a.activa]));

  const ordenadas = [...pedidasUnicas].sort();
  if (ordenadas.some((id) => !activaPorSucursal.has(id))) {
    return err("SUCURSAL_NO_ES_DE_LA_EMPRESA");
  }
  // Sin fila activa: hay que escribir (insertar o prender), y para eso la sucursal tiene que estar activa.
  const aEscribir = ordenadas.filter((id) => filaPorSucursal.get(id) !== true);
  if (aEscribir.some((id) => activaPorSucursal.get(id) !== true)) return err("SUCURSAL_INACTIVA");

  return ok({
    agregadas: aEscribir.filter((id) => !filaPorSucursal.has(id)),
    reactivadas: aEscribir.filter((id) => filaPorSucursal.has(id)),
    quitadas: actuales
      .filter((a) => a.activa && !pedidasUnicas.has(a.sucursalId))
      .map((a) => a.sucursalId)
      .sort(),
  });
}
