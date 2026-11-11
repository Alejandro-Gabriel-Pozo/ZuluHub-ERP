import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const MESAS = "test/integracion/salon-mesas.test.ts";
const DIVISION = "test/integracion/salon-division.test.ts";
const UNION = "test/integracion/salon-union.test.ts";
const PEDIDO = "test/integracion/salon-pedido-y-cobro.test.ts";

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
  tomarPedido: {
    accion: "cuentas.abrir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: PEDIDO,
        it: "I5: dos mozos que tocan «Tomar pedido» a la vez reciben la misma cuenta (yaExistia); repetir no abre otra",
      },
    },
  },
  agregarAlPedido: {
    accion: "cuentas.agregar_linea",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: PEDIDO,
        it: "I6: repetir agregarAlPedido con el mismo id deja una línea y un estado de comanda, y devuelve yaExistia",
      },
    },
  },
  liberarMesa: {
    accion: "cuentas.anular",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: PEDIDO,
        it: "I7: liberar dos veces la misma mesa es ok y no audita la segunda; con un ítem vigente, MESA_CON_PEDIDO",
      },
    },
  },
  cambiarDeMesa: {
    accion: "salon.cambiar_mesa",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: PEDIDO,
        it: "I8: cambiar dos veces a la misma mesa es ok (yaExistia) y no audita la segunda",
      },
    },
  },
  cobrarMesa: {
    // La declaración admite UNA acción; el caso exige además `cuentas.cerrar` y `cuentas.anular` (ver `cobro.ts`).
    accion: "tickets.cobrar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: PEDIDO,
        it: "I9: doble clic en cobrar la mesa deja un ticket, un cobro y la mesa libre, y devuelve yaExistia",
      },
    },
  },
  enviarACocina: {
    accion: "comandas.enviar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: PEDIDO,
        it: "I10: doble toque en «Enviar a cocina» con el mismo envío deja un envío y un trabajo, y devuelve yaExistia",
      },
    },
  },
  pedirQueSalga: {
    accion: "comandas.enviar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: PEDIDO,
        it: "I11: repetir «Pedir que salga» con el mismo envío no crea otro",
      },
    },
  },
  anularItemEnviado: {
    // La declaración admite UNA acción; el caso exige además `cuentas.agregar_linea` (lo parcial crea la línea del resto).
    accion: "cuentas.anular_linea",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: PEDIDO,
        it: "I12: doble clic en anular un ítem enviado deja una anulación y un aviso",
      },
    },
  },
  unirMesas: {
    // La declaración admite UNA acción; el caso exige además `cuentas.anular_linea` y `cuentas.agregar_linea` (ver `unir.ts`).
    accion: "salon.unir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: UNION,
        it: "I13: repetir unirMesas con la misma unión deja una sola unión, los ítems una vez y devuelve yaExistia",
      },
    },
  },
  dividirCuenta: {
    // La declaración admite UNA acción; el caso exige además `cuentas.abrir`, `cuentas.anular_linea` y `cuentas.agregar_linea` (ver `dividir.ts`).
    accion: "salon.dividir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: DIVISION,
        it: "I14: doble clic en «Confirmar división» deja una sola división, las cuentas hijas una vez y devuelve yaExistia",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
