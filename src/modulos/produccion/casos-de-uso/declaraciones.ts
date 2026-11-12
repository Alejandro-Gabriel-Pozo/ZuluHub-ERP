import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const ARCHIVO_DE_ORDENES = "test/integracion/produccion-ordenes.test.ts";
const ARCHIVO_DE_IDEMPOTENCIA = "test/integracion/produccion-idempotencia.test.ts";

/**
 * Los casos de uso de producción (E6 §3.2) y la acción que cada uno exige al guard (cruce X1 de ADR-003), con cómo se repite sin duplicar
 * (ADR-015 §4) y la prueba que lo fija. El `satisfies` de `casos-de-uso.ts` exige que los casos de uso sean EXACTAMENTE los declarados.
 */
export const DECLARACIONES = {
  abrirOrden: {
    accion: "transformaciones.abrir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_IDEMPOTENCIA,
        it: "I1: abrir la misma orden dos veces (clic doble, mismo id) deja una orden y un número; con otro contenido, ID_REUTILIZADO",
      },
    },
  },
  cerrarOrden: {
    accion: "transformaciones.cerrar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_IDEMPOTENCIA,
        it: "I2: cerrar con la misma clave dos veces, y con otra clave sobre la misma orden, deja un solo cierre y la segunda devuelve yaExistia",
      },
    },
  },
  cancelarOrden: {
    accion: "transformaciones.cancelar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_ORDENES,
        it: "cancelar dos veces es ok, no escribe ni audita la segunda; una cerrada es ORDEN_YA_CERRADA",
      },
    },
  },
  anularOrden: {
    accion: "transformaciones.anular",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_IDEMPOTENCIA,
        it: "I4: anular dos veces deja un solo par de espejos y la segunda devuelve yaEstaba; anular la anulación se rechaza",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
