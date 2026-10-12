import type { ReglasDeGrupo } from "../capacidades/permisos/grupo";
import type { RepositorioDeEmpresas } from "../modulos/empresas/publico";
import type { RepositorioDeTenants } from "../modulos/tenants/publico";
import type { AuditoriaDeAccesoDeGrupo } from "../puertos/auditoria-de-acceso-de-grupo";
import type { CargaDeAutorizacionDeGrupo } from "../puertos/autorizacion-de-grupo";
import type { Transacciones } from "../puertos/transacciones";

/**
 * Lo que recibe el trabajo de una consulta de grupo (ADR-005): solo métodos de LECTURA de los
 * repositorios de los módulos (entran por su `publico.ts`), la carga de autorización y el registro de
 * acceso. El registro es la única escritura posible, y por tipos no hay ninguna otra: ni auditoría de
 * empresa, ni trabajos, ni los métodos de alta o cambio de los repositorios.
 */
export type TxDeConsultasDeGrupo = Readonly<{
  tenants: Pick<RepositorioDeTenants, "obtener">;
  empresas: Pick<RepositorioDeEmpresas, "listarDelTenant">;
  autorizacion: CargaDeAutorizacionDeGrupo;
  /** Quién consultó la vista de grupo (R3): se escribe en la misma transacción de la lectura. */
  accesos: AuditoriaDeAccesoDeGrupo;
}>;

export type DependenciasDeConsultasDeGrupo = Readonly<{
  /** Transacciones con el contexto de GRUPO: entran con el rol de base `zuluhub_grupo`, nunca el de la aplicación. */
  transacciones: Transacciones<TxDeConsultasDeGrupo>;
  /** El catálogo y la matriz de grupo con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeGrupo;
}>;
