import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { EstadoDeTenant } from "../../../contexto/estados";
import type { TenantId } from "../../../primitivas/identificadores/marca";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { RepositorioDeEmpresas, RepositorioDeSucursales } from "../../empresas/publico";
import type { RepositorioDePortales } from "../persistencia/repositorio-de-portales";

/** Lo que recibe el trabajo de una transacción del portal (ADR-004): el repositorio, las sucursales, la auditoría y la autorización, leídas dentro de la transacción (sin caché). */
export type TxDePortal = Readonly<{
  portales: RepositorioDePortales;
  empresas: Pick<RepositorioDeEmpresas, "obtener">;
  tenants: Readonly<{
    obtener(id: TenantId): Promise<Readonly<{ estado: EstadoDeTenant }> | null>;
  }>;
  sucursales: Pick<RepositorioDeSucursales, "obtener">;
  auditoria: Auditoria;
  /** Quién es el actor, qué módulos tiene la empresa y en qué sucursales opera. */
  autorizacion: CargaDeAutorizacion;
}>;

export type DependenciasDePortal = Readonly<{
  transacciones: Transacciones<TxDePortal>;
  /** La matriz rol → acciones con la que el guard autoriza (la pasa la composición). */
  reglas: ReglasDeEmpresa;
  /**
   * El puerto de azar del código del portal: devuelve un código nuevo de ≥ 128 bits al azar en base64url (22 caracteres). El dominio no tiene azar: lo pone la
   * composición (`node:crypto`) y las pruebas lo fijan. Es la llave del QR de la empresa.
   */
  generarCodigoDePortal: () => string;
}>;

/** El portal tal como lo devuelve el repositorio: las consultas por pantalla lo toman de acá (ADR-005: no importan el dominio). */
export type { Portal } from "../dominio/portal";
