import type { ContextoOperativo } from "../../../contexto/contexto";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { EstadoDeEmpresa, EstadoDeTenant } from "../../../contexto/estados";
import type { EmpresaId, TenantId } from "../../../primitivas/identificadores/marca";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type {
  RepositorioDeEmisores,
  RepositorioDePuntosDeVenta,
  RepositorioDeSeries,
} from "../persistencia/repositorios";
import type { OpcionesDeNumeracion } from "../dominio/numeracion";
import type { EmisionElectronica } from "./emision-electronica";

/**
 * Lo que recibe el trabajo de una transacción de numeración (ADR-004, G5): los repositorios fiscales
 * que usa, la lectura de estados (empresa y tenant, tipados por su forma: fiscal no conoce a esos
 * módulos), y los puertos de auditoría y autorización. La composición lo arma a partir de la conexión
 * de la transacción; los casos de uso solo ven estas interfaces.
 */
export type TxDeNumeracion = Readonly<{
  empresas: Readonly<{
    obtener(
      id: EmpresaId,
    ): Promise<Readonly<{ tenantId: TenantId; estado: EstadoDeEmpresa }> | null>;
  }>;
  tenants: Readonly<{
    obtener(id: TenantId): Promise<Readonly<{ estado: EstadoDeTenant }> | null>;
  }>;
  puntosDeVenta: Pick<RepositorioDePuntosDeVenta, "obtener">;
  emisores: Pick<RepositorioDeEmisores, "obtener">;
  series: Pick<RepositorioDeSeries, "obtener" | "crear" | "guardar" | "enCursoVencidas">;
  auditoria: Auditoria;
  /** Quién es el actor y qué módulos tiene la empresa, leído dentro de la transacción (sin caché). */
  autorizacion: CargaDeAutorizacion;
}>;

export type DependenciasDeNumeracion = Readonly<{
  transacciones: Transacciones<TxDeNumeracion>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
  /**
   * El servicio de emisión (ARCA o, en pruebas, el adaptador falso). Se usa SIEMPRE fuera de una
   * transacción (ADR-007). Un adaptador por punto de venta lo elegirá la composición.
   */
  emision: EmisionElectronica;
  /** Plazo de la reserva y tope del número; por defecto `OPCIONES_DE_NUMERACION`. */
  opciones?: OpcionesDeNumeracion;
}>;

/**
 * El contexto de un trabajo de sistema (ADR-007): operativo, de la empresa del trabajo, SIN persona.
 * Un contexto con persona no compila donde se pide este.
 */
export type ContextoDeSistema = ContextoOperativo & Readonly<{ personaId: null }>;
