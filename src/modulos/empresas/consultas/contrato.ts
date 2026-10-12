import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { RepositorioDeEmpresas, RepositorioDeSucursales } from "../persistencia/repositorios";

/**
 * Lo que recibe el trabajo de una consulta (ADR-005): solo métodos de lectura de los repositorios
 * y la carga de autorización. No hay auditoría ni trabajos: por tipos, una consulta no escribe.
 */
export type TxDeConsultasDeEmpresas = Readonly<{
  sucursales: Pick<RepositorioDeSucursales, "obtener" | "listar" | "listarActivas">;
  empresas: Pick<RepositorioDeEmpresas, "obtener">;
  autorizacion: CargaDeAutorizacion;
}>;

export type DependenciasDeConsultasDeEmpresas = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeEmpresas>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;
