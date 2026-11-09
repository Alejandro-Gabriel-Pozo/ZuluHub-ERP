import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { LecturaDeEstados } from "../../empresas/publico";
import type { RegistroDeAportes } from "../aporte-al-cierre";
import type { RepositorioDeJornadas } from "../persistencia/repositorio-de-jornadas";

/**
 * Lo que recibe el trabajo de una transacción del cierre (ADR-004, G5): el repositorio de jornadas, la lectura de estados (la empresa
 * opera) y los puertos de auditoría y autorización. La composición lo arma a partir de la conexión de la transacción, que es la MISMA
 * que ven los aportes de los demás módulos: lo que ellos leen y congelan es atómico con el cierre.
 */
export type TxDeCierre = LecturaDeEstados &
  Readonly<{
    jornadas: RepositorioDeJornadas;
    auditoria: Auditoria;
    /** Quién es el actor, qué módulos tiene la empresa y a qué sucursales llega, leído dentro de la transacción (sin caché). */
    autorizacion: CargaDeAutorizacion;
  }>;

/**
 * `TAportes` es lo que necesitan los aportes de los otros módulos para leer y congelar (sus repositorios, sobre la misma conexión): la
 * composición pasa una transacción que es `TxDeCierre & TAportes`. Sin aportes, `unknown`.
 */
export type DependenciasDeCierre<TAportes = unknown> = Readonly<{
  transacciones: Transacciones<TxDeCierre & TAportes>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
  /**
   * Los aportes de los módulos (caja, ventas...), registrados por la composición. Cierre usa SOLO los de los módulos activos de la
   * empresa; un módulo sin aporte no impide cerrar. Dos aportes del mismo módulo es un error de armado (lanza al crear los casos).
   */
  aportes: RegistroDeAportes<TAportes>;
}>;
