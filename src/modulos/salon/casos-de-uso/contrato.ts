import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Transacciones } from "../../../puertos/transacciones";
import type { LecturaDeDerechosDeUso } from "../../../puertos/derechos-de-uso";
import type { TxDeComandas } from "../../comandas/publico";
import type { StockDeVentas } from "../../ventas/publico";
import type { RepositoriosDeSalon } from "../persistencia/repositorios-de-salon";

/**
 * Lo que recibe el trabajo de una transacción del salón (ADR-004, G5): todo lo de comandas (que incluye lo de ventas: cuentas, líneas, tickets, caja,
 * jornada, auditoría y autorización) más sus repositorios. El salón orquesta ventas y comandas en la MISMA transacción: la composición la arma sobre la
 * conexión de la transacción, la misma que ven catálogo, cierre y caja, así que lo que se lee y se escribe es atómico.
 */
export type TxDeSalon = TxDeComandas &
  RepositoriosDeSalon &
  Readonly<{
    /** Lo que el plan de la empresa le deja usar (la perilla `salon`), leído en esta transacción y sin caché. */
    derechos: Pick<LecturaDeDerechosDeUso, "deLaEmpresa">;
  }>;

export type DependenciasDeSalon = Readonly<{
  transacciones: Transacciones<TxDeSalon>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
  /**
   * Quien descuenta y devuelve stock (lo arma la composición con stock, el MISMO que usa ventas). Sin él (`usaSiExiste: stock`) ninguna línea controla
   * stock y el salón no llama a nada: la empresa con stock apagado vende como antes.
   */
  stock?: StockDeVentas<TxDeSalon> | undefined;
}>;
