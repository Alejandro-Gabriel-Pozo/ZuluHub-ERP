import type { Kysely } from "kysely";
import {
  crearRepositorioDeSaldos,
  type RepositorioDeSaldos,
  type SaldosDb,
} from "../../saldos_de_partes/publico";
import type { CuentaDelClienteDb } from "./esquema";
import {
  crearRepositorioDeCuentasDeClientes,
  type RepositorioDeCuentasDeClientes,
} from "./repositorio-de-cuentas";

export type RepositoriosDeCuentaCorriente = Readonly<{
  cuentasDeClientes: RepositorioDeCuentasDeClientes;
  /** La lectura del libro de saldos (los saldos derivados): este módulo no escribe asientos. */
  saldos: RepositorioDeSaldos;
}>;

/** Los repositorios del módulo sobre la conexión de UNA transacción (la composición los suma a `TxDeApp`). */
export function crearRepositoriosDeCuentaCorriente(db: {
  withTables<T extends object>(): Kysely<T & CuentaDelClienteDb & SaldosDb>;
}): RepositoriosDeCuentaCorriente {
  const tablas = db.withTables<CuentaDelClienteDb & SaldosDb>();
  return {
    cuentasDeClientes: crearRepositorioDeCuentasDeClientes(tablas),
    saldos: crearRepositorioDeSaldos(tablas),
  };
}
