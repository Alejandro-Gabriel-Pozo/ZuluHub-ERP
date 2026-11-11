import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Transacciones } from "../../../puertos/transacciones";
import type { RepositoriosDeClientes } from "../../clientes/publico";
import type { TxDeStock } from "../../stock/publico";
import type { RepositoriosDeCompras } from "../persistencia/repositorios-de-compras";

/**
 * Lo que recibe el trabajo de una transacción de compras (ADR-004): los repositorios de compras, el directorio de partes (los proveedores son partes) y todo lo de
 * stock (sucursal, auditoría, autorización, estado de la empresa y los repositorios con que stock registra la entrada: la compra y su entrada de stock son UNA
 * transacción). La composición lo arma sobre la conexión de la transacción.
 */
export type TxDeCompras = TxDeStock & RepositoriosDeCompras & RepositoriosDeClientes;

export type DependenciasDeCompras = Readonly<{
  transacciones: Transacciones<TxDeCompras>;
  /** El catálogo de módulos y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;

/** Lo que reciben las consultas: transacciones de solo lectura con la autorización y los repositorios (que solo leen). */
export type TxDeConsultasDeCompras = Pick<TxDeStock, "autorizacion"> &
  RepositoriosDeCompras &
  RepositoriosDeClientes;

export type DependenciasDeConsultasDeCompras = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeCompras>;
  reglas: ReglasDeEmpresa;
}>;
