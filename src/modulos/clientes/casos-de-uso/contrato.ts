import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { LecturaDeEstados } from "../../empresas/publico";
import type { RepositoriosDeClientes } from "../persistencia/repositorios-de-clientes";

/**
 * Lo que recibe el trabajo de una transacción del directorio (ADR-004): los repositorios, la auditoría, la autorización (quién es el actor y qué módulos
 * tiene la empresa, leído dentro de la transacción, sin caché) y el estado de la empresa y su tenant para decidir si opera. La composición lo arma sobre la
 * conexión de la transacción. El directorio es de la EMPRESA (no de una sucursal): no usa el alcance de sucursales.
 */
export type TxDeClientes = LecturaDeEstados &
  RepositoriosDeClientes &
  Readonly<{
    auditoria: Auditoria;
    autorizacion: CargaDeAutorizacion;
  }>;

export type DependenciasDeClientes = Readonly<{
  transacciones: Transacciones<TxDeClientes>;
  /** El catálogo de módulos y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;

/** Lo que reciben las consultas: transacciones de solo lectura con la autorización y los repositorios (que solo leen). */
export type TxDeConsultasDeClientes = RepositoriosDeClientes &
  Readonly<{
    autorizacion: CargaDeAutorizacion;
  }>;

export type DependenciasDeConsultasDeClientes = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeClientes>;
  reglas: ReglasDeEmpresa;
}>;
