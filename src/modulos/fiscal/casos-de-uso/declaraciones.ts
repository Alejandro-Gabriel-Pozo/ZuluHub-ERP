import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

/**
 * Los casos de uso de numeración (H7, especificación §B.8) y la acción que cada uno exige al guard
 * (cruce X1 de ADR-003). Emitir completa algo ya vendido o cobrado: la acción es `comprobantes.emitir`.
 */
export const DECLARACIONES = {
  reservarNumeroDeComprobante: {
    accion: "comprobantes.emitir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/fiscal-numeracion.test.ts",
        it: "repetir con la misma solicitud devuelve el mismo número, sin escribir ni auditar de nuevo",
      },
    },
  },
  cerrarReservaDeNumero: {
    accion: "comprobantes.emitir",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/fiscal-numeracion.test.ts",
        it: "repetir el cierre autorizado da el mismo éxito (yaCerrada) y no avanza dos veces ni audita de nuevo",
      },
    },
  },
  reconciliarSerie: {
    sinGuard:
      "Trabajo de sistema (ADR-007): corre sin persona (contexto operativo con personaId null) y solo mira lo que dice el servicio de emisión; el permiso se exigió al reservar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/fiscal-numeracion.test.ts",
        it: "repetir la reconciliación da el mismo éxito (NADA_QUE_RECONCILIAR) sin escribir ni auditar otra vez",
      },
    },
  },
  reconciliarSeriesVencidas: {
    sinGuard:
      "Trabajo de sistema (ADR-007): recorre las reservas vencidas de la empresa del trabajo y reconcilia cada una",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/fiscal-numeracion.test.ts",
        it: "reconciliarSeriesVencidas resuelve solo las vencidas de SU empresa, de la más vieja a la más nueva, y respeta el límite",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
