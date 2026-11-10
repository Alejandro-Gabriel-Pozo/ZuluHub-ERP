import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const ARCHIVO = "test/integracion/ventas-casos-de-uso.test.ts";

/**
 * Los casos de uso de ventas (E4 §3.4 y §3.8) y la acción que cada uno exige al guard (cruce X1 de ADR-003), con cómo se repite sin duplicar
 * (ADR-015 §4) y la prueba que lo fija. `corregirTicket` (solo líneas) es contrato sin pantalla y no se construye en el piloto (§3.8);
 * `cobrar` y `venderYCobrar` son de la fase B (dependen del puerto de caja).
 */
export const DECLARACIONES = {
  abrirCuenta: {
    accion: "cuentas.abrir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO,
        it: "I1: repetir abrirCuenta con el mismo id deja una cuenta y devuelve yaExistia; con otro contenido, CUENTA_ID_EN_USO",
      },
    },
  },
  agregarLinea: {
    accion: "cuentas.agregar_linea",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO,
        it: "I2: repetir agregarLinea con el mismo id deja una línea y devuelve yaExistia; con otro contenido, LINEA_ID_EN_USO",
      },
    },
  },
  anularLinea: {
    accion: "cuentas.anular_linea",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO,
        it: "I3: anular dos veces la misma línea es ok y no audita la segunda",
      },
    },
  },
  anularCuenta: {
    accion: "cuentas.anular",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO,
        it: "I4: anular dos veces la misma cuenta es ok y no audita la segunda",
      },
    },
  },
  cerrarCuenta: {
    accion: "cuentas.cerrar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO,
        it: "I5: cerrar dos veces la misma cuenta deja un solo ticket y el mismo número",
      },
    },
  },
  anularTicket: {
    accion: "tickets.corregir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO,
        it: "I6: repetir anularTicket con la misma clave anula una vez; con otra huella, CLAVE_REUTILIZADA",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
