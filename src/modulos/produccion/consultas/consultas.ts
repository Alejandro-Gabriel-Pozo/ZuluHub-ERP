import type { DependenciasDeConsultasDeProduccion } from "../casos-de-uso/contrato";
import { crearLector } from "./comun";
import { armarConsultasDeOrdenes } from "./ordenes";

/** Las consultas por pantalla de producción (ADR-005): solo lectura, cada una pide su acción al guard dentro de su transacción. */
export function crearConsultasDeProduccion(d: DependenciasDeConsultasDeProduccion) {
  const leer = crearLector(d);
  return { ...armarConsultasDeOrdenes(leer, d.reglas) };
}

export type ConsultasDeProduccion = ReturnType<typeof crearConsultasDeProduccion>;
