import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Transacciones } from "../../../puertos/transacciones";
import type { TxDeVentas } from "../../ventas/publico";
import type { RepositoriosDeSalon } from "../persistencia/repositorios-de-salon";

/**
 * Lo que recibe el trabajo de una transacción del salón (ADR-004, G5): todo lo de ventas (cuentas, líneas, tickets, caja, jornada, auditoría y
 * autorización: el salón orquesta ventas) más sus repositorios. La composición lo arma sobre la conexión de la transacción, la MISMA que ven ventas,
 * comandas, catálogo, cierre y caja: lo que se lee y se escribe es atómico.
 */
export type TxDeSalon = TxDeVentas & RepositoriosDeSalon;

export type DependenciasDeSalon = Readonly<{
  transacciones: Transacciones<TxDeSalon>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;
