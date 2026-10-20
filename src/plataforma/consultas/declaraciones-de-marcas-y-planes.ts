import type { DeclaracionDeAccionDePlataforma } from "./declaraciones";

/**
 * Las consultas de plataforma sobre marcas y planes (M5, §B.11) y la acción que cada una exige al guard.
 * SOPORTE ve (`marcas.ver`, `planes.ver`); no cambia estructura. Una acción que no existe en el catálogo
 * de plataforma, o una declaración vacía, no compila; y la fábrica exige que cada consulta tenga la suya.
 */
export const DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES = {
  listarMarcas: { accion: "marcas.ver" },
  fichaDeMarca: { accion: "marcas.ver" },
  listarPlanes: { accion: "planes.ver" },
  fichaDePlan: { accion: "planes.ver" },
  planDelTenant: { accion: "planes.ver" },
  derechosDeUsoDeEmpresa: { accion: "planes.ver" },
  diferenciaEntreVersiones: { accion: "planes.ver" },
} as const satisfies Record<string, DeclaracionDeAccionDePlataforma>;
