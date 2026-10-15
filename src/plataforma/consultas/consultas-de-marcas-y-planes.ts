import { armarFichaDeMarca, armarListarMarcas } from "./consultas-de-marcas";
import {
  armarDerechosDeUsoDeEmpresa,
  armarDiferenciaEntreVersiones,
  armarFichaDePlan,
  armarListarPlanes,
  armarPlanDelTenant,
} from "./consultas-de-planes";
import type { DependenciasDeConsultasDeMarcasYPlanes } from "./contrato-de-marcas-y-planes";
import type { DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES } from "./declaraciones-de-marcas-y-planes";

/**
 * Las consultas de plataforma sobre marcas y planes (M5, §B.11), listas para que la composición las
 * ofrezca. El `satisfies` exige que sean EXACTAMENTE las que declara
 * `DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES` (qué acción exige cada una): una consulta sin declarar, o
 * una declaración sin consulta, no compila.
 */
export function crearConsultasDeMarcasYPlanes(
  dependencias: DependenciasDeConsultasDeMarcasYPlanes,
) {
  return {
    listarMarcas: armarListarMarcas(dependencias),
    fichaDeMarca: armarFichaDeMarca(dependencias),
    listarPlanes: armarListarPlanes(dependencias),
    fichaDePlan: armarFichaDePlan(dependencias),
    planDelTenant: armarPlanDelTenant(dependencias),
    derechosDeUsoDeEmpresa: armarDerechosDeUsoDeEmpresa(dependencias),
    diferenciaEntreVersiones: armarDiferenciaEntreVersiones(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES, unknown>;
}

export type ConsultasDeMarcasYPlanes = ReturnType<typeof crearConsultasDeMarcasYPlanes>;
