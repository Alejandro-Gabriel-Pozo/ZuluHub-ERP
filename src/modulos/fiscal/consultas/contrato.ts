import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { MarcaParaImprimir } from "../dominio/modelo-de-impresion";
import type { LecturasDeComprobantes } from "../persistencia/lecturas-de-comprobantes";
import type { RepositorioDeComprobantes } from "../persistencia/repositorio-de-comprobantes";
import type { RepositorioDeIntentos } from "../persistencia/repositorio-de-intentos";
import type { RepositorioDeSeries } from "../persistencia/repositorios";

/**
 * Lo que recibe el trabajo de una consulta (ADR-005): solo métodos de lectura de los repositorios y la carga
 * de autorización. No hay auditoría ni trabajos: por tipos, una consulta no escribe. Los certificados y las
 * credenciales de acceso a ARCA no figuran: ninguna consulta del facturador los lee.
 */
export type TxDeConsultasDeFacturacion = Readonly<{
  comprobantes: Pick<RepositorioDeComprobantes, "obtener">;
  lecturas: LecturasDeComprobantes;
  intentos: Pick<RepositorioDeIntentos, "delComprobante">;
  series: Pick<RepositorioDeSeries, "obtener">;
  /**
   * La marca con la que se imprime el comprobante de una empresa: la de su tenant, con la herencia ya
   * resuelta. La arma la composición desde `marcas` (fiscal no importa ese módulo: la marca es presentación);
   * si la marca no tiene logo o color, los campos vienen en `null`.
   */
  marca: Readonly<{ deLaEmpresa(empresa: EmpresaId): Promise<MarcaParaImprimir> }>;
  /**
   * Las sucursales ACTIVAS de la empresa (las del módulo de empresas: la composición pasa su repositorio, que ya cumple
   * esto). De ellas y del alcance del actor sale la sucursal en la que trabaja el listado (`sucursal-del-pedido.ts`).
   */
  sucursales: Readonly<{
    listarActivas(empresa: EmpresaId): Promise<readonly Readonly<{ id: SucursalId }>[]>;
  }>;
  /** Quién es el actor y qué módulos tiene la empresa, leído dentro de la transacción (sin caché). */
  autorizacion: CargaDeAutorizacion;
}>;

export type DependenciasDeConsultasDeFacturacion = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeFacturacion>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;
