import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

/**
 * Los casos de uso del cierre del día (E3b §3.3) y la acción que cada uno exige al guard (cruce X1 de ADR-003), con cómo se repite
 * cada uno sin duplicar (ADR-015 §4): los tres son idempotentes POR ESTADO (`YA_ESTABA`), sin clave de idempotencia.
 */
export const DECLARACIONES = {
  iniciarAuditoria: {
    accion: "jornadas.iniciar_auditoria",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/cierre-casos-de-uso.test.ts",
        it: "iniciar la auditoría dos veces: la segunda devuelve yaEstabaEnAuditoria y no escribe ni audita",
      },
    },
  },
  cancelarAuditoria: {
    accion: "jornadas.cancelar_auditoria",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/cierre-casos-de-uso.test.ts",
        it: "cancelar la auditoría dos veces: la segunda devuelve yaEstabaAbierta y no escribe ni audita",
      },
    },
  },
  cerrarJornada: {
    accion: "jornadas.cerrar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/cierre-casos-de-uso.test.ts",
        it: "doble clic en «Cerrar el día»: un solo cierre, una sola foto de controles y una sola auditoría; el segundo devuelve yaEstabaCerrada",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
