import type { Kysely } from "kysely";
import type { SalonDb } from "./esquema";
import { crearRepositorioDeMesas, type RepositorioDeMesas } from "./repositorio-de-mesas";
import {
  crearRepositorioDeUnionesYDivisiones,
  type RepositorioDeUnionesYDivisiones,
} from "./repositorio-de-uniones-y-divisiones";

/** Los repositorios del salón, armados sobre la MISMA conexión de la transacción (la composición los suma a la `Tx` compuesta). */
export type RepositoriosDeSalon = Readonly<{
  mesas: RepositorioDeMesas;
  unionesYDivisiones: RepositorioDeUnionesYDivisiones;
}>;

export function crearRepositoriosDeSalon(db: {
  withTables<T extends object>(): Kysely<T & SalonDb>;
}): RepositoriosDeSalon {
  const conexion = db.withTables<SalonDb>();
  return {
    mesas: crearRepositorioDeMesas(conexion),
    unionesYDivisiones: crearRepositorioDeUnionesYDivisiones(conexion),
  };
}
