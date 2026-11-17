import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Transacciones } from "../../../puertos/transacciones";
import type { TxDeConsultasDeStock, TxDeStock } from "../../stock/publico";
import type { RepositoriosDeProduccion } from "../persistencia/repositorios-de-produccion";

/**
 * Lo que recibe el trabajo de una transacción de producción (ADR-004): los repositorios de producción y todo lo de stock (sucursales, auditoría,
 * autorización, estado de la empresa, el nivel de los controles y los repositorios con que stock escribe el libro): la orden y sus movimientos son UNA
 * transacción. La composición lo arma sobre la conexión de la transacción. Producción NO escribe tablas de stock: lo hace por `stock/publico.ts`.
 */
export type TxDeProduccion = TxDeStock & RepositoriosDeProduccion;

export type DependenciasDeProduccion = Readonly<{
  transacciones: Transacciones<TxDeProduccion>;
  /** El catálogo de módulos y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;

/** Lo que reciben las consultas: transacciones de solo lectura con la autorización y los repositorios (que solo leen). */
export type TxDeConsultasDeProduccion = TxDeConsultasDeStock & RepositoriosDeProduccion;

export type DependenciasDeConsultasDeProduccion = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeProduccion>;
  reglas: ReglasDeEmpresa;
}>;
