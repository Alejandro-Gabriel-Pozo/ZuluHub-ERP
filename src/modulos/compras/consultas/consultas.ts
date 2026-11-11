import type { DependenciasDeConsultasDeCompras } from "../casos-de-uso/contrato";
import { crearLector } from "./comun";
import { armarConsultasDeFicha } from "./ficha";

/**
 * Las consultas por pantalla de compras (ADR-005): solo lectura (`read committed`), cada una pide su acción al guard dentro de su transacción. Una fila de
 * otra empresa es indistinguible de una que no existe (la RLS).
 */
export function crearConsultasDeCompras(d: DependenciasDeConsultasDeCompras) {
  const leer = crearLector(d);
  return { ...armarConsultasDeFicha(leer) };
}

export type ConsultasDeCompras = ReturnType<typeof crearConsultasDeCompras>;
