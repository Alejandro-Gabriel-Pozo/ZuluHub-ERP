import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

/**
 * Los casos de uso de la configuración de caja (e3 §3.2) y la acción que cada uno exige al guard (cruce X1 de ADR-003), con cómo se
 * repite cada uno sin duplicar (ADR-015 §4): los de alta y los de desactivar y reactivar son idempotentes POR ESTADO (`YA_ESTABA`: lo
 * pedido ya está hecho) y los de edición por `SIN_CAMBIOS` (ya es lo pedido). Ninguno lleva clave de idempotencia: la identidad natural
 * (el nombre, único sin distinguir mayúsculas) y el estado alcanzan. Los de la operación que crean un registro (abrir la sesión, ingreso o
 * egreso, ajuste y anulación) llevan clave de idempotencia (`CLAVE_DE_IDEMPOTENCIA`: la genera la pantalla al abrir el formulario); iniciar y
 * cancelar el cierre y cerrar son idempotentes por estado. El cobro lo suma el tramo siguiente.
 */
export const DECLARACIONES = {
  crearCaja: {
    accion: "cajas.crear",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/caja-configuracion-casos-de-uso.test.ts",
        it: "crear la misma caja dos veces: la segunda devuelve yaExistia y no escribe ni audita",
      },
    },
  },
  asegurarCajaPorDefecto: {
    accion: "sesiones_caja.abrir",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/caja-por-defecto.test.ts",
        it: "asegurarCajaPorDefecto dos veces: la segunda devuelve la misma caja con creada false y no escribe ni audita",
      },
    },
  },
  editarCaja: {
    accion: "cajas.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: "test/integracion/caja-configuracion-casos-de-uso.test.ts",
        it: "repetir la edición ya aplicada de una caja devuelve la versión vigente y no escribe ni audita",
      },
    },
  },
  desactivarCaja: {
    accion: "cajas.desactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/caja-configuracion-casos-de-uso.test.ts",
        it: "desactivar una caja dos veces: la segunda devuelve yaEstabaInactiva y no escribe ni audita",
      },
    },
  },
  reactivarCaja: {
    accion: "cajas.reactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/caja-configuracion-casos-de-uso.test.ts",
        it: "reactivar una caja dos veces: la segunda devuelve yaEstabaActiva y no escribe ni audita",
      },
    },
  },
  crearMedioDePago: {
    accion: "medios_de_pago.crear",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/caja-configuracion-casos-de-uso.test.ts",
        it: "crear el mismo medio de pago dos veces: el segundo devuelve yaExistia y no escribe ni audita",
      },
    },
  },
  editarMedioDePago: {
    accion: "medios_de_pago.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: "test/integracion/caja-configuracion-casos-de-uso.test.ts",
        it: "repetir la edición ya aplicada de un medio de pago devuelve la versión vigente y no escribe ni audita",
      },
    },
  },
  desactivarMedioDePago: {
    accion: "medios_de_pago.desactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/caja-configuracion-casos-de-uso.test.ts",
        it: "desactivar un medio de pago dos veces: el segundo devuelve yaEstabaInactivo y no escribe ni audita",
      },
    },
  },
  reactivarMedioDePago: {
    accion: "medios_de_pago.reactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/caja-configuracion-casos-de-uso.test.ts",
        it: "reactivar un medio de pago dos veces: el segundo devuelve yaEstabaActivo y no escribe ni audita",
      },
    },
  },
  crearCuentaDeCobro: {
    accion: "cuentas_de_cobro.crear",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/caja-configuracion-casos-de-uso.test.ts",
        it: "crear la misma cuenta de cobro dos veces: la segunda devuelve yaExistia y no escribe ni audita",
      },
    },
  },
  editarCuentaDeCobro: {
    accion: "cuentas_de_cobro.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: "test/integracion/caja-configuracion-casos-de-uso.test.ts",
        it: "repetir la edición ya aplicada de una cuenta de cobro devuelve la versión vigente y no escribe ni audita",
      },
    },
  },
  desactivarCuentaDeCobro: {
    accion: "cuentas_de_cobro.desactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/caja-configuracion-casos-de-uso.test.ts",
        it: "desactivar una cuenta de cobro dos veces: la segunda devuelve yaEstabaInactiva y no escribe ni audita",
      },
    },
  },
  reactivarCuentaDeCobro: {
    accion: "cuentas_de_cobro.reactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/caja-configuracion-casos-de-uso.test.ts",
        it: "reactivar una cuenta de cobro dos veces: la segunda devuelve yaEstabaActiva y no escribe ni audita",
      },
    },
  },
  abrirSesion: {
    accion: "sesiones_caja.abrir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/caja-operacion-casos-de-uso.test.ts",
        it: "abrir la sesión dos veces con la misma clave: la segunda devuelve yaExistia y no escribe ni audita",
      },
    },
  },
  iniciarCierre: {
    accion: "sesiones_caja.iniciar_cierre",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/caja-operacion-casos-de-uso.test.ts",
        it: "iniciar el cierre dos veces: el segundo devuelve yaEstabaEnCierre y no escribe ni audita",
      },
    },
  },
  cancelarCierre: {
    accion: "sesiones_caja.cancelar_cierre",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/caja-operacion-casos-de-uso.test.ts",
        it: "cancelar el cierre de una sesión abierta: devuelve yaEstabaAbierta y no escribe ni audita",
      },
    },
  },
  cerrarSesion: {
    accion: "sesiones_caja.cerrar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/caja-operacion-casos-de-uso.test.ts",
        it: "cerrar dos veces con el mismo conteo: la segunda devuelve yaEstabaCerrada con el arqueo guardado y no escribe ni audita",
      },
    },
  },
  registrarMovimientoManual: {
    accion: "movimientos_caja.registrar_manual",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/caja-operacion-casos-de-uso.test.ts",
        it: "registrar el mismo ingreso dos veces con la misma clave: el segundo devuelve yaExistia y no escribe ni audita",
      },
    },
  },
  registrarAjuste: {
    accion: "movimientos_caja.ajustar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/caja-operacion-casos-de-uso.test.ts",
        it: "registrar el mismo ajuste dos veces con la misma clave: el segundo devuelve yaExistia y no escribe ni audita",
      },
    },
  },
  anularMovimientoDeCaja: {
    accion: "movimientos_caja.anular",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/caja-operacion-casos-de-uso.test.ts",
        it: "anular el mismo movimiento dos veces con la misma clave: la segunda devuelve yaExistia y no escribe ni audita",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
