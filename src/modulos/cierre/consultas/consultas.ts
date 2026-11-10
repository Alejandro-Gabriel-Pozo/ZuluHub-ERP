import { armarControlesDeLaJornada } from "./controles-de-la-jornada";
import type { DependenciasDeConsultasDeCierre } from "./contrato";
import type { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { armarEstadoDeJornada } from "./estado-de-jornada";
import { armarListarJornadas } from "./listar-jornadas";

/**
 * Las consultas por pantalla del cierre del día (ADR-005). El `satisfies` exige que cada una tenga su declaración (qué acción exige):
 * una consulta sin declarar, o con una acción que no existe en el catálogo, no compila.
 */
export function crearConsultasDeCierre<TAportes = unknown>(
  dependencias: DependenciasDeConsultasDeCierre<TAportes>,
) {
  return {
    estadoDeJornada: armarEstadoDeJornada(dependencias),
    listarJornadas: armarListarJornadas(dependencias),
    controlesDeLaJornada: armarControlesDeLaJornada(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_CONSULTAS, unknown>;
}

export type ConsultasDeCierre = ReturnType<typeof crearConsultasDeCierre>;
