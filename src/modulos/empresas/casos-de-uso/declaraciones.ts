import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

/**
 * Los casos de uso de sucursales (H6, especificación §B.1) y la acción que cada uno exige al guard
 * (cruce X1 de ADR-003). Se declaran en el tramo T0 para que los tramos paralelos no se pisen; cada
 * caso de uso se implementa en T2.
 */
export const DECLARACIONES = {
  crearSucursal: {
    accion: "sucursales.crear",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/sucursales-casos-de-uso.test.ts",
        it: "idempotente: repetir el alta devuelve la misma sucursal (yaExistia) y no duplica nada",
      },
    },
  },
  editarSucursal: {
    accion: "sucursales.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: "test/integracion/sucursales-casos-de-uso.test.ts",
        it: "idempotente: repetir la edición ya aplicada devuelve la versión vigente y no escribe ni audita",
      },
    },
  },
  desactivarSucursal: {
    accion: "sucursales.desactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/sucursales-casos-de-uso.test.ts",
        it: "idempotente: desactivar dos veces es ok, no escribe ni audita la segunda y no sube la versión",
      },
    },
  },
  reactivarSucursal: {
    accion: "sucursales.reactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/sucursales-casos-de-uso.test.ts",
        it: "reactivar dos veces escribe una sola vez",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
