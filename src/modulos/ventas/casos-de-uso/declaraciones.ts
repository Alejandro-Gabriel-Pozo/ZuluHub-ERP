import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const ARCHIVO = "test/integracion/ventas-casos-de-uso.test.ts";
const ARCHIVO_DE_COBRO = "test/integracion/ventas-cobro.test.ts";

/**
 * Los casos de uso de ventas (E4 §3.4 y §3.8) y la acción que cada uno exige al guard (cruce X1 de ADR-003), con cómo se repite sin duplicar
 * (ADR-015 §4) y la prueba que lo fija. `corregirTicket` (solo líneas) es contrato sin pantalla y no se construye en el piloto (§3.8);
 * `cobrar` y `venderYCobrar` (fase B) cobran por el puerto de caja.
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
  cobrar: {
    accion: "tickets.cobrar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_COBRO,
        it: "I7: repetir cobrar con la misma clave cobra una vez y devuelve lo hecho; con otra huella, CLAVE_REUTILIZADA",
      },
    },
  },
  emitirComprobanteDeTicket: {
    // La declaración admite UNA acción y X1 no deja que una carpeta declare la de otro módulo: se declara `ventas.ver`; el caso exige además
    // `comprobantes.emitir` (ver `emitir-comprobante-de-ticket.ts`) y fiscal pide la suya otra vez.
    accion: "ventas.ver",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/ventas-facturar-casos.test.ts",
        it: "P1: repetir emitirComprobanteDeTicket con la misma clave deja una factura, un puntero y un trabajo, y devuelve yaExistia",
      },
    },
  },
  venderYCobrar: {
    // La declaración admite UNA acción; el caso exige además `cuentas.abrir`, `cuentas.agregar_linea` y `cuentas.cerrar` (ver `vender-y-cobrar.ts`).
    accion: "tickets.cobrar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_COBRO,
        it: "I8: repetir venderYCobrar con la misma clave deja una venta, un ticket y un cobro, y devuelve yaExistia",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
