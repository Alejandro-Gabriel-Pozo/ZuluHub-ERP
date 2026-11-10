import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { RegistroDeAportes } from "../aporte-al-cierre";
import type { RepositorioDeJornadas } from "../persistencia/repositorio-de-jornadas";

/**
 * Lo que recibe el trabajo de una consulta (ADR-005): solo métodos de lectura del repositorio y la carga de autorización. No hay
 * auditoría: por tipos, una consulta no escribe.
 */
export type TxDeConsultasDeCierre = Readonly<{
  jornadas: Pick<RepositorioDeJornadas, "obtener" | "listar" | "controlesGuardados">;
  autorizacion: CargaDeAutorizacion;
}>;

export type DependenciasDeConsultasDeCierre<TAportes = unknown> = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeCierre & TAportes>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
  /** Los mismos aportes que usan los casos de uso: de ellos salen los controles en vivo mientras la jornada no está cerrada. */
  aportes: RegistroDeAportes<TAportes>;
}>;
