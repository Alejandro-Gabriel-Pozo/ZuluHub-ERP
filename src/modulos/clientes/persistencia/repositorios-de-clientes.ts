import type { Kysely } from "kysely";
import type { ClientesDb } from "./esquema";
import { crearRepositorioDePartes, type RepositorioDePartes } from "./repositorios-de-partes";

/**
 * Los repositorios del directorio, armados sobre la MISMA conexión de la transacción. La composición los junta con los de los demás módulos en UNA sola
 * `Tx`: el nombre genérico lleva `DeClientes` para no pisar a otros. Una prueba de la composición exige que ninguna clave se repita.
 */
export type RepositoriosDeClientes = Readonly<{
  partes: RepositorioDePartes;
}>;

export function crearRepositoriosDeClientes(db: {
  withTables<T extends object>(): Kysely<T & ClientesDb>;
}): RepositoriosDeClientes {
  return { partes: crearRepositorioDePartes(db.withTables<ClientesDb>()) };
}
