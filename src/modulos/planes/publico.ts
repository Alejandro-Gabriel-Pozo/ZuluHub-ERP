/** Entrada pública del módulo de planes (ADR-001): por ahora, su dominio puro (M2). */
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
