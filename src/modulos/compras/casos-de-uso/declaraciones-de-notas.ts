import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const ARCHIVO_DE_NOTAS = "test/integracion/compras-n4-notas-de-credito.test.ts";
const ARCHIVO_DE_REEMPLAZO = "test/integracion/compras-reemplazo-de-factura.test.ts";
const ARCHIVO_DE_NOTAS_DE_DEBITO = "test/integracion/compras-notas-de-debito.test.ts";

/** Los casos de uso de las notas del proveedor y del reemplazo de factura con su acción y cómo se repiten (parte de `DECLARACIONES`, separada para no pasar del tope de líneas por archivo). */
export const DECLARACIONES_DE_NOTAS = {
  registrarNotaDeCredito: {
    accion: "notas_de_credito_de_proveedor.registrar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_NOTAS,
        it: "I1: la misma nota dos veces (misma clave) deja una sola nota y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA",
      },
    },
  },
  anularNotaDeCredito: {
    accion: "notas_de_credito_de_proveedor.anular",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_NOTAS,
        it: "I2: anular dos veces la misma nota devuelve yaEstaba y la segunda no escribe ni audita",
      },
    },
  },
  reemplazarFactura: {
    accion: "comprobantes_de_proveedor.reemplazar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_REEMPLAZO,
        it: "I1: reemplazar dos veces con la misma clave (también a la vez) deja una sola factura nueva y una sola auditoría; con otro contenido, CLAVE_REUTILIZADA",
      },
    },
  },
  registrarNotaDeDebito: {
    accion: "notas_de_debito_de_proveedor.registrar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_NOTAS_DE_DEBITO,
        it: "I1: la misma nota de débito dos veces (misma clave, también a la vez) deja una sola nota y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA",
      },
    },
  },
  anularNotaDeDebito: {
    accion: "notas_de_debito_de_proveedor.anular",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_NOTAS_DE_DEBITO,
        it: "I2: anular dos veces la misma nota de débito devuelve yaEstaba y la segunda no escribe ni audita",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
