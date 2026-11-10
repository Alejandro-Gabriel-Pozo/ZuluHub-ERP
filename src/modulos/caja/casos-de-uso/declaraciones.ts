import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

/**
 * Los casos de uso de la configuración de caja (e3 §3.2) y la acción que cada uno exige al guard (cruce X1 de ADR-003), con cómo se
 * repite cada uno sin duplicar (ADR-015 §4): los de alta y los de desactivar y reactivar son idempotentes POR ESTADO (`YA_ESTABA`: lo
 * pedido ya está hecho) y los de edición por `SIN_CAMBIOS` (ya es lo pedido). Ninguno lleva clave de idempotencia: la identidad natural
 * (el nombre, único sin distinguir mayúsculas) y el estado alcanzan. Los casos de la operación (sesión, movimientos, cobro) los suman los
 * tramos siguientes.
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
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
