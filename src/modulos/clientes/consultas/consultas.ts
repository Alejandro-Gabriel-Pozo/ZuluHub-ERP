import type { DependenciasDeConsultasDeClientes } from "../casos-de-uso/contrato";
import { crearLector } from "./comun";
import { armarConsultasDePartes } from "./partes";

/**
 * Las consultas por pantalla del directorio (ADR-005): solo lectura (`read committed`), cada una pide su acción al guard dentro de su transacción. Una parte de
 * otra empresa es indistinguible de una que no existe (la RLS).
 */
export function crearConsultasDeClientes(d: DependenciasDeConsultasDeClientes) {
  const leer = crearLector(d);
  return { ...armarConsultasDePartes(leer) };
}

export type ConsultasDeClientes = ReturnType<typeof crearConsultasDeClientes>;
