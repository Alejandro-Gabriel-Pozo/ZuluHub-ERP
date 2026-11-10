import type { DependenciasDeConsultasDeStock } from "../casos-de-uso/contrato";
import { crearLector } from "./comun";
import { armarConsultasDeDepositos } from "./depositos";
import { armarConsultasDeExistencias } from "./existencias";
import { armarConsultasDeLibro } from "./libro";

/**
 * Las consultas por pantalla de stock (ADR-005): solo lectura (`read committed`), cada una pide su acción al guard dentro de su transacción.
 * Un depósito, artículo o movimiento de otra empresa es indistinguible de uno que no existe (la RLS). Cada tramo suma las suyas acá.
 */
export function crearConsultasDeStock(d: DependenciasDeConsultasDeStock) {
  const leer = crearLector(d);
  return {
    // depósitos (E5-T4)
    ...armarConsultasDeDepositos(leer),
    // existencias, libro y verificación de saldos (E5-T5)
    ...armarConsultasDeExistencias(leer),
    ...armarConsultasDeLibro(leer),
  };
}

export type ConsultasDeStock = ReturnType<typeof crearConsultasDeStock>;
