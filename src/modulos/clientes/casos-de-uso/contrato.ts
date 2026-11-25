import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Trabajos } from "../../../puertos/trabajos";
import type { Transacciones } from "../../../puertos/transacciones";
import type { LecturaDeEstados } from "../../empresas/publico";
import type { RepositoriosDeClientes } from "../persistencia/repositorios-de-clientes";
import type { AnonimizacionDePartesEnTx } from "../puertos-de-anonimizacion";

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

/**
 * Lo que recibe la transacción de los casos de uso del directorio: `TxDeClientes` más lo que necesita `anonimizarParte` (la cola, para avisar a los módulos
 * que guardan copias, y lo que impide anonimizar con las copias que se vacían, que arma la composición sobre la misma conexión). Va aparte para que los demás
 * módulos que usan `TxDeClientes` con su propia transacción (compras) no tengan que traerlo.
 */
export type TxDeCasosDeUsoDeClientes = TxDeClientes &
  Readonly<{
    trabajos: Trabajos;
    anonimizacionDePartes: AnonimizacionDePartesEnTx;
  }>;

export type DependenciasDeClientes = Readonly<{
  transacciones: Transacciones<TxDeCasosDeUsoDeClientes>;
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
