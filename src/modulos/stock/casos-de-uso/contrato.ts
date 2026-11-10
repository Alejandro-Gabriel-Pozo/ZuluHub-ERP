import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { LecturaDeEstados, RepositorioDeSucursales } from "../../empresas/publico";
import type { RepositoriosDeStock } from "../persistencia/repositorios-de-stock";

/**
 * Lo que recibe el trabajo de una transacción de stock (ADR-004): los repositorios de stock (con el lector del catálogo, que lee en la
 * MISMA transacción), la sucursal (para saber si existe y está abierta), la auditoría y la autorización, y el estado de la empresa y su
 * tenant para decidir si opera. La composición lo arma sobre la conexión de la transacción.
 */
export type TxDeStock = LecturaDeEstados &
  RepositoriosDeStock &
  Readonly<{
    sucursales: Pick<RepositorioDeSucursales, "obtener">;
    auditoria: Auditoria;
    /** Quién es el actor, qué módulos tiene la empresa y en qué sucursales opera, leído dentro de la transacción (sin caché). */
    autorizacion: CargaDeAutorizacion;
  }>;

export type DependenciasDeStock = Readonly<{
  transacciones: Transacciones<TxDeStock>;
  /** El catálogo de módulos y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;

/** Lo que reciben las consultas: transacciones de solo lectura con la autorización y los repositorios (que solo leen). */
export type TxDeConsultasDeStock = RepositoriosDeStock &
  Readonly<{
    autorizacion: CargaDeAutorizacion;
  }>;

export type DependenciasDeConsultasDeStock = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeStock>;
  reglas: ReglasDeEmpresa;
}>;
