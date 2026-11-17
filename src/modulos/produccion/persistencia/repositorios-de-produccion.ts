import type { Kysely } from "kysely";
import type { ProduccionDb } from "./esquema";
import { crearRepositorioDeOrdenes, type RepositorioDeOrdenes } from "./repositorio-de-ordenes";

/**
 * Los repositorios de producción, armados sobre la MISMA conexión de la transacción (la composición los junta con los de stock en UNA `Tx`: la orden y
 * sus movimientos del libro se escriben juntos). El nombre lleva `DeProduccion` para no pisar a los de otros módulos.
 */
export type RepositoriosDeProduccion = Readonly<{
  ordenesDeProduccion: RepositorioDeOrdenes;
}>;

export function crearRepositoriosDeProduccion(db: {
  withTables<T extends object>(): Kysely<T & ProduccionDb>;
}): RepositoriosDeProduccion {
  return { ordenesDeProduccion: crearRepositorioDeOrdenes(db.withTables<ProduccionDb>()) };
}
