import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { LecturaDeEstados } from "../../empresas/publico";
import type { TxDeSaldos } from "../../saldos_de_partes/publico";
import type { RepositorioDeCuentasDeClientes } from "../persistencia/repositorio-de-cuentas";

/**
 * Lo que recibe el trabajo de una transacción de la cuenta corriente de clientes (ADR-004, G5): el repositorio de la ficha, la lectura de estados (la empresa
 * opera), la lectura del libro de saldos (solo `saldos`: este módulo no escribe asientos; los escriben CC-2 y CC-3), la auditoría y la autorización. La composición lo
 * arma a partir de la conexión de la transacción; los casos de uso solo ven estas interfaces.
 */
export type TxDeCuentaCorriente = LecturaDeEstados &
  Readonly<{
    cuentasDeClientes: RepositorioDeCuentasDeClientes;
    saldos: TxDeSaldos["saldos"];
    auditoria: Auditoria;
    /** Quién es el actor y qué módulos tiene la empresa, leído dentro de la transacción (sin caché). */
    autorizacion: CargaDeAutorizacion;
  }>;

export type DependenciasDeCuentaCorriente = Readonly<{
  transacciones: Transacciones<TxDeCuentaCorriente>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;
