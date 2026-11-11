import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const MESAS = "test/integracion/salon-mesas.test.ts";

/**
 * Los casos de uso del salón (E7 §3.4) y la acción que cada uno exige al guard (cruce X1 de ADR-003), con cómo se repite sin duplicar (ADR-015 §4) y la
 * prueba que lo fija. Los de pedido, cambio de mesa, cobro, unir y dividir se suman con su tramo.
 */
export const DECLARACIONES = {
  crearMesa: {
    accion: "mesas.crear",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: MESAS,
        it: "I1: guardar dos veces la misma mesa deja una sola y devuelve yaExistia; con otro contenido, MESA_ID_EN_USO",
      },
    },
  },
  editarMesa: {
    accion: "mesas.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: MESAS,
        it: "I2: editar una mesa con los mismos datos no escribe ni audita y devuelve yaExistia",
      },
    },
  },
  desactivarMesa: {
    accion: "mesas.desactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: MESAS,
        it: "I3: desactivar dos veces la misma mesa es ok y no audita la segunda",
      },
    },
  },
  reactivarMesa: {
    accion: "mesas.reactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: MESAS,
        it: "I4: reactivar dos veces la misma mesa es ok y no audita la segunda",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
