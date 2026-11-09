/** Entrada pública del módulo de cierre del día (ADR-001; e3b §3). */
export {
  SEVERIDADES,
  MAXIMO_DE_REFERENCIAS,
  controlesDelAporte,
  huellaDeControles,
  impideCerrar,
  pideReconocimiento,
  type AporteAlCierreDelDia,
  type ControlDelDia,
  type ErrorDeAporte,
  type JornadaRef,
  type ReconocimientoDeControl,
  type ReferenciaOpaca,
  type RegistroDeAportes,
  type Severidad,
} from "./aporte-al-cierre";
export {
  decidirCierre,
  reconocimientosValidos,
  repiteElCierre,
  type ControlResuelto,
  type ErrorDeCierre,
  type Reconocimiento,
  type ReconocimientoPedido,
} from "./dominio/cierre";
export { LARGO_MAXIMO_DE_LA_EXPLICACION, explicacionDesdeTexto } from "./dominio/explicacion";
export {
  ESTADOS_DE_JORNADA,
  TRANSICIONES_DE_JORNADA,
  decidirCancelar,
  decidirIniciar,
  transicionPermitida,
  type EstadoConsultado,
  type EstadoDeJornada,
  type Jornada,
} from "./dominio/jornada";
export {
  jornadaDeSucursal,
  type ErrorDeJornadaNoAbierta,
  type ErrorDeJornadaNoEnAuditoria,
  type JornadaDeSucursal,
  type TxDeJornadas,
} from "./jornada-de-sucursal";
export {
  COLUMNAS_DE_CIERRE,
  ERRORES_DE_CIERRE_POR_RESTRICCION,
  crearRepositorioDeJornadas,
  type CierreDb,
  type ClaveDeJornada,
  type ControlAGuardar,
  type ControlGuardado,
  type RepositorioDeJornadas,
} from "./persistencia/repositorio-de-jornadas";
export { DECLARACIONES as DECLARACIONES_DE_CIERRE } from "./casos-de-uso/declaraciones";
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_CIERRE } from "./consultas/declaraciones";
export { crearCasosDeUsoDeCierre, type CasosDeUsoDeCierre } from "./casos-de-uso/casos-de-uso";
export type { DependenciasDeCierre, TxDeCierre } from "./casos-de-uso/contrato";
export type {
  ControlDeJornada,
  EntradaDeCerrarJornada,
  ErrorAlCerrarJornada,
  SalidaDeCerrarJornada,
} from "./casos-de-uso/cerrar-jornada";
export type {
  EntradaDeIniciarAuditoria,
  ErrorAlIniciarAuditoria,
  ImpedimentosDeLaJornada,
  SalidaDeIniciarAuditoria,
} from "./casos-de-uso/iniciar-auditoria";
export type {
  EntradaDeCancelarAuditoria,
  ErrorAlCancelarAuditoria,
  SalidaDeCancelarAuditoria,
} from "./casos-de-uso/cancelar-auditoria";
export type { ImpedimentoDeJornada } from "./casos-de-uso/comun";
export type { AporteNoDisponible, EntradaDeJornada } from "./comun";
export { crearConsultasDeCierre, type ConsultasDeCierre } from "./consultas/consultas";
export type { DependenciasDeConsultasDeCierre, TxDeConsultasDeCierre } from "./consultas/contrato";
export {
  MAXIMO_DE_JORNADAS_POR_PEDIDO,
  type EntradaDeListarJornadas,
  type JornadaDeLista,
} from "./consultas/listar-jornadas";
export type { EstadoDeLaJornada } from "./consultas/estado-de-jornada";
export type {
  ControlDeLaPantalla,
  ControlesDeLaJornada,
} from "./consultas/controles-de-la-jornada";
