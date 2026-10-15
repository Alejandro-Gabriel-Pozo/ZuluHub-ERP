/** Entrada pública del módulo de planes (ADR-001): su dominio puro (M2) y sus lecturas (M4). */
export {
  decidirActivacion,
  decidirDesactivacion,
  type ErrorDeActivacion,
  type ErrorDeDesactivacion,
  type ModuloParaActivar,
  type PedidoDeActivacion,
} from "./dominio/activacion";
export {
  decidirAjuste,
  type AjusteDecidido,
  type ErrorDeAjuste,
  type PedidoDeAjuste,
} from "./dominio/ajuste";
export {
  decidirAsignacion,
  type AsignacionDecidida,
  type AsignacionDePlan,
  type ErrorDeAsignacion,
  type OrigenDeAsignacion,
  type PedidoDeAsignacion,
  type VersionDeDestino,
} from "./dominio/asignacion";

// M4: lecturas de planes para los derechos de uso (solo lectura).
export {
  crearLecturaDePlanes,
  type AjusteGuardado,
  type AsignacionConVersion,
  type LecturaDePlanes,
} from "./persistencia/lecturas";
export type { PlanesDb } from "./persistencia/tablas";
export {
  ERRORES_DE_PLANES_POR_RESTRICCION,
  RESTRICCIONES_DE_DISPARADORES_DE_PLANES,
  type ErrorDePlanesPorRestriccion,
} from "./persistencia/esquema";
export { errorDePlanesDeRestriccion, traducirErroresDePlanes } from "./persistencia/traducir";

// M6: lo que el alta de una empresa lee y escribe de planes y módulos (conexión de plataforma).
export {
  crearAsignacionesDePlanDelAlta,
  crearLecturaDeVersionesDePlanParaElAlta,
  crearModulosDeEmpresaDelAlta,
  type AsignacionDeAlta,
  type AsignacionesDePlanDelAlta,
  type LecturaDeVersionesDePlanParaElAlta,
  type ModulosDeEmpresaDelAlta,
  type PlanesDelAltaDb,
  type VersionDePlanAsignable,
} from "./persistencia/del-alta";
