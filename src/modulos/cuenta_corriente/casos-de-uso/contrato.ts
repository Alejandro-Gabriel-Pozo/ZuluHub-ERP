import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { TxDeClientes } from "../../clientes/publico";
import type { LecturaDeEstados } from "../../empresas/publico";
import type { TxDeSaldos } from "../../saldos_de_partes/publico";
import type { RepositorioDeCuentasDeClientes } from "../persistencia/repositorio-de-cuentas";
import type { ApoyoDeLaExportacion } from "./puertos-de-exportacion";
import type { CuentasDeConsumoParaVender } from "./puertos-de-venta";

/**
 * Lo que recibe el trabajo de una transacción de la cuenta corriente de clientes (ADR-004, G5): el repositorio de la ficha, la lectura de estados (la empresa
 * opera), la lectura del libro de saldos (solo `saldos`: este módulo no escribe asientos; los escriben CC-2 y CC-3), la auditoría y la autorización. La composición lo
 * arma a partir de la conexión de la transacción; los casos de uso solo ven estas interfaces.
 */
export type TxDeCuentaCorriente = LecturaDeEstados &
  Readonly<{
    cuentasDeClientes: RepositorioDeCuentasDeClientes;
    /** El directorio de partes: de ahí salen el nombre y el CUIT del cliente en el estado de cuenta y en la exportación (CC-4). */
    partes: TxDeClientes["partes"];
    saldos: TxDeSaldos["saldos"];
    auditoria: Auditoria;
    /** Quién es el actor y qué módulos tiene la empresa, leído dentro de la transacción (sin caché). */
    autorizacion: CargaDeAutorizacion;
  }>;

export type DependenciasDeCuentaCorriente = Readonly<{
  transacciones: Transacciones<TxDeCuentaCorriente>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
  /** Lo que la exportación lee de otros módulos (medio de pago de las cobranzas y nombre de sucursales); lo arma la composición. Sin él, exportar se rechaza (nace cerrado). */
  apoyoDeLaExportacion?: ApoyoDeLaExportacion<TxDeCuentaCorriente> | undefined;
  /** La cuenta de consumo que se vende (CC-5, C3): la arma la composición. Sin ella, `verClienteParaVender` se rechaza (nace cerrado). */
  cuentasDeConsumoParaVender?: CuentasDeConsumoParaVender<TxDeCuentaCorriente> | undefined;
}>;
