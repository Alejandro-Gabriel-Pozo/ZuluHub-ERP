import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { EstadoDeTenant } from "../../../contexto/estados";
import type { TenantId } from "../../../primitivas/identificadores/marca";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { RepositorioDeEmpresas, RepositorioDeSucursales } from "../persistencia/repositorios";

/**
 * Lo que necesita un caso de uso para saber si la empresa opera: su estado y el de su tenant. El
 * tenant se tipa por su forma y no por el módulo de tenants, que empresas no conoce (R3).
 */
export type LecturaDeEstados = Readonly<{
  empresas: Pick<RepositorioDeEmpresas, "obtener">;
  tenants: Readonly<{
    obtener(id: TenantId): Promise<Readonly<{ estado: EstadoDeTenant }> | null>;
  }>;
}>;

/**
 * Lo que recibe el trabajo de una transacción de sucursales (ADR-004, G5): el repositorio del
 * módulo, la lectura de estados y los puertos de auditoría y autorización. La composición lo arma a
 * partir de la conexión de la transacción; los casos de uso solo ven estas interfaces.
 */
export type TxDeEmpresas = LecturaDeEstados &
  Readonly<{
    sucursales: RepositorioDeSucursales;
    auditoria: Auditoria;
    /** Quién es el actor y qué módulos tiene la empresa, leído dentro de la transacción (sin caché). */
    autorizacion: CargaDeAutorizacion;
  }>;

export type DependenciasDeEmpresas = Readonly<{
  transacciones: Transacciones<TxDeEmpresas>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;
