import { diasEntre } from "../../primitivas/tiempo/dias";
import type { FechaCivil } from "../../primitivas/tiempo/fecha-civil";

/**
 * Lo que comparten el dominio de la exportación y las consultas (que no pueden importar el dominio: regla `consultas-sin-dominio`, ADR-005): la antigüedad de un movimiento y los datos
 * de un cliente para mostrar. Una regla, un lugar: la antigüedad de la lista, del estado de cuenta y de la exportación es esta.
 */

/** Días desde la fecha de negocio del movimiento hasta la fecha de referencia; nunca negativo (un movimiento de «mañana» no existe: cuenta como de hoy). */
export function antiguedadEnDias(fechaDeNegocio: FechaCivil, hoy: FechaCivil): number {
  return Math.max(0, diasEntre(fechaDeNegocio, hoy));
}

/** El nombre para mostrar y el CUIT de un cliente (`null`: anonimizado, de otra empresa o sin dato). */
export type DatosDelCliente = Readonly<{ nombre: string | null; cuit: string | null }>;
