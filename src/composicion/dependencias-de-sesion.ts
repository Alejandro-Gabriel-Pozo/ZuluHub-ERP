import type { ConsultasDeEmpresas } from "../modulos/empresas/publico";
import type { CasosDeUsoDeIdentidad, ConsultasDeSesion } from "../modulos/identidad/publico";
import type { Autenticacion } from "../puertos/autenticacion";
import type { DependenciasDeRespuesta } from "./a-respuesta";

export type DependenciasDeSesion = Readonly<{
  autenticacion: () => Autenticacion;
  consultasDeSesion: () => ConsultasDeSesion;
  casosDeUsoDeIdentidad: () => CasosDeUsoDeIdentidad;
  consultasDeEmpresas: () => ConsultasDeEmpresas;
  /** El reloj: se toma UNA vez por operación y entra como dato (ADR-004, regla G4). */
  ahora: () => Date;
  respuesta: DependenciasDeRespuesta;
}>;
