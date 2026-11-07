import type { ConsultasDeEmpresas } from "../modulos/empresas/publico";
import type { CasosDeUsoDeIdentidad, ConsultasDeSesion } from "../modulos/identidad/publico";
import type { Autenticacion } from "../puertos/autenticacion";
import type { LecturasCompartidas } from "../puertos/transacciones";
import type { DependenciasDeRespuesta } from "./a-respuesta";

export type DependenciasDeSesion = Readonly<{
  autenticacion: () => Autenticacion;
  consultasDeSesion: () => ConsultasDeSesion;
  casosDeUsoDeIdentidad: () => CasosDeUsoDeIdentidad;
  consultasDeEmpresas: () => ConsultasDeEmpresas;
  /**
   * Las lecturas de un mismo pedido que comparten una transacción de solo lectura. Opcional: sin él cada consulta abre la suya (más
   * viajes a la base, mismo resultado). La web real lo pasa siempre.
   */
  lecturasCompartidas?: () => LecturasCompartidas;
  /** El reloj: se toma UNA vez por operación y entra como dato (ADR-004, regla G4). */
  ahora: () => Date;
  respuesta: DependenciasDeRespuesta;
}>;
