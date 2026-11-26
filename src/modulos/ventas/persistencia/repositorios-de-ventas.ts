import type { Kysely } from "kysely";
import type { VentasDb } from "./esquema";
import {
  crearRepositorioDeDocumentos,
  type RepositorioDeDocumentos,
} from "./repositorio-de-documentos";
import { crearRepositorioDeCuentas, type RepositorioDeCuentas } from "./repositorio-de-cuentas";
import { crearRepositorioDeLecturas, type LecturasDeVentas } from "./repositorio-de-lecturas";
import {
  crearLecturaDeTicketsParaCuentas,
  type LecturaDeTicketsParaCuentas,
} from "./lectura-de-tickets-para-cuentas";
import { crearRepositorioDeTickets, type RepositorioDeTickets } from "./repositorio-de-tickets";

/** Los repositorios de ventas, armados sobre la MISMA conexión de la transacción (la composición los suma a la `Tx` compuesta). */
export type RepositoriosDeVentas = Readonly<{
  cuentas: RepositorioDeCuentas;
  tickets: RepositorioDeTickets;
  documentos: RepositorioDeDocumentos;
  lecturasDeVentas: LecturasDeVentas;
  /** CC-5: el número, la sucursal y el canal de un ticket para mostrarlo como origen de un movimiento de la cuenta corriente. */
  ticketsParaCuentas: LecturaDeTicketsParaCuentas;
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
    ticketsParaCuentas: crearLecturaDeTicketsParaCuentas(conexion),
  };
}
