import type { NivelesDeControl } from "../../../capacidades/controles/niveles";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { LecturaDeDerechosDeUso } from "../../../puertos/derechos-de-uso";
import type { Transacciones } from "../../../puertos/transacciones";
import type { LecturaDeEstados, RepositorioDeSucursales } from "../../empresas/publico";
import type { RepositoriosDeStock } from "../persistencia/repositorios-de-stock";

/**
 * Lo que recibe el trabajo de una transacción de stock (ADR-004): los repositorios de stock (con el lector del catálogo, que lee en la
 * MISMA transacción), la sucursal (para saber si existe, está abierta y cuál es su jornada), el nivel de los controles, la auditoría y la autorización, y el estado de la empresa y su
 * tenant para decidir si opera. La composición lo arma sobre la conexión de la transacción.
 */
export type TxDeStock = LecturaDeEstados &
  RepositoriosDeStock &
  Readonly<{
    /** `obtener`: la sucursal existe y está abierta; `jornadaDe`: la zona y el corte para decidir si una fecha cae en la jornada vigente. */
    sucursales: Pick<RepositorioDeSucursales, "obtener" | "jornadaDe">;
    /** El nivel vigente de `stock.existencia_negativa`, leído en la misma transacción (la base lo repite en el disparador del renglón). */
    niveles: NivelesDeControl;
    auditoria: Auditoria;
    /** Quién es el actor, qué módulos tiene la empresa y en qué sucursales opera, leído dentro de la transacción (sin caché). */
    autorizacion: CargaDeAutorizacion;
    /** Lo que el plan deja usar (las perillas de pérdida y subcomposiciones de la receta), leído en esta transacción y sin caché. */
    derechos: Pick<LecturaDeDerechosDeUso, "deLaEmpresa">;
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
