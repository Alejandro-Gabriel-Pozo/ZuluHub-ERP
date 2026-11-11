import type { ConfiguracionDeTransacciones } from "../adaptadores/postgres/transacciones";
import { crearRepositoriosDeCatalogo } from "../modulos/catalogo/publico";
import { crearRepositoriosDeClientes } from "../modulos/clientes/publico";
import { crearRepositoriosDeStock } from "../modulos/stock/publico";
import { crearRepositoriosDeVentas } from "../modulos/ventas/publico";

/**
 * Lo de los módulos de negocio que lleva la `Tx` compuesta de la puerta de la aplicación (`TxDeApp`): los repositorios de catálogo (E2), ventas (E4)
 * stock (E5) y clientes (E9), todos sobre la MISMA conexión de la transacción (así el cierre de una cuenta, que cruza ventas, caja y stock, es una sola
 * transacción). Los nombres de los de stock llevan `DeStock` para no pisar a los de caja; `tipos-tx.test.ts` comprueba que la compuesta contiene la
 * `Tx` angosta de cada módulo. Vive en su archivo para que `conexiones.ts` no pase el tope de líneas; cada módulo nuevo suma el suyo acá.
 */
export type PiezasDeModulosEnTx = ReturnType<typeof crearRepositoriosDeCatalogo> &
  ReturnType<typeof crearRepositoriosDeVentas> &
  ReturnType<typeof crearRepositoriosDeStock> &
  ReturnType<typeof crearRepositoriosDeClientes>;

export function armarPiezasDeModulosEnTx(
  db: Parameters<ConfiguracionDeTransacciones<unknown>["armar"]>[0],
): PiezasDeModulosEnTx {
  return {
    ...crearRepositoriosDeCatalogo(db),
    ...crearRepositoriosDeVentas(db),
    ...crearRepositoriosDeStock(db),
    ...crearRepositoriosDeClientes(db),
  };
}
