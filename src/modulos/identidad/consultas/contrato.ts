import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { RepositorioDeSucursales } from "../../empresas/publico";
import type {
  RepositorioDeAsignaciones,
  RepositorioDeInvitaciones,
  RepositorioDeMembresias,
  RepositorioDePersonas,
  RepositorioDeTraspasos,
} from "../persistencia/repositorios";

/**
 * Lo que recibe el trabajo de una consulta (ADR-005): solo métodos de lectura de los repositorios y
 * la carga de autorización. No hay auditoría ni trabajos: por tipos, una consulta no escribe.
 */
export type TxDeConsultasDeIdentidad = Readonly<{
  membresias: Pick<RepositorioDeMembresias, "listarConEmail">;
  asignaciones: Pick<RepositorioDeAsignaciones, "activasDeLaEmpresa">;
  invitaciones: Pick<RepositorioDeInvitaciones, "pendientesDeLaEmpresa">;
  traspasos: Pick<RepositorioDeTraspasos, "enCurso">;
  /** Para poner el email de las personas del traspaso. */
  personas: Pick<RepositorioDePersonas, "obtener">;
  /** Para saber qué sucursales están activas: la asignación efectiva es "asignación y sucursal activas". */
  sucursales: Pick<RepositorioDeSucursales, "listarActivas">;
  /** Quién es el actor y qué módulos tiene la empresa, leído dentro de la transacción (sin caché). */
  autorizacion: CargaDeAutorizacion;
}>;

export type DependenciasDeConsultasDeIdentidad = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeIdentidad>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;
