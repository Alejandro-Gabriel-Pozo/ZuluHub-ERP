import type { Kysely } from "kysely";
import type { VentasDb } from "./esquema";
import {
  crearRepositorioDeDocumentos,
  type RepositorioDeDocumentos,
} from "./repositorio-de-documentos";
import { crearRepositorioDeCuentas, type RepositorioDeCuentas } from "./repositorio-de-cuentas";
import { crearRepositorioDeLecturas, type LecturasDeVentas } from "./repositorio-de-lecturas";
import { crearRepositorioDeTickets, type RepositorioDeTickets } from "./repositorio-de-tickets";

/** Los repositorios de ventas, armados sobre la MISMA conexión de la transacción (la composición los suma a la `Tx` compuesta). */
export type RepositoriosDeVentas = Readonly<{
  cuentas: RepositorioDeCuentas;
  tickets: RepositorioDeTickets;
  documentos: RepositorioDeDocumentos;
  lecturasDeVentas: LecturasDeVentas;
}>;

export function crearRepositoriosDeVentas(db: {
  withTables<T extends object>(): Kysely<T & VentasDb>;
}): RepositoriosDeVentas {
  const conexion = db.withTables<VentasDb>();
  return {
    cuentas: crearRepositorioDeCuentas(conexion),
    tickets: crearRepositorioDeTickets(conexion),
    documentos: crearRepositorioDeDocumentos(conexion),
    lecturasDeVentas: crearRepositorioDeLecturas(conexion),
  };
}
