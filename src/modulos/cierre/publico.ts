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
