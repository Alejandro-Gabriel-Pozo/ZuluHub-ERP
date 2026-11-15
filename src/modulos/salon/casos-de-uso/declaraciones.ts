import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const MESAS = "test/integracion/salon-mesas.test.ts";
const DIVISION = "test/integracion/salon-division.test.ts";
const UNION = "test/integracion/salon-union.test.ts";
const PEDIDO = "test/integracion/salon-pedido-y-cobro.test.ts";

/**
 * Los casos de uso del salón (E7 §3.4) y las acciones que cada uno exige al guard (cruce X1 de ADR-003), con cómo se repite sin duplicar (ADR-015 §4) y la
 * prueba que lo fija. `accion` es la del módulo (X1) y `tambien` las de ventas y comandas que usa por dentro: el caso las lee de acá (`accionesDeCaso`), así que declaración y
 * guard son la misma lista (la prueba de paridad es `guard-primero-de-salon-y-comandas.test.ts`).
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
        it: "I3: desactivar dos veces la misma mesa es ok y no audita la segunda; sus casillas quedan libres",
      },
    },
  },
  reactivarMesa: {
    accion: "mesas.reactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: MESAS,
        it: "I4: reactivar dos veces la misma mesa es ok y no audita la segunda; vuelve a validar las casillas",
      },
    },
  },
  tomarPedido: {
    accion: "mesas.ver",
    tambien: ["cuentas.abrir"],
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: PEDIDO,
        it: "I5: dos mozos que tocan «Tomar pedido» a la vez reciben la misma cuenta (yaExistia); repetir no abre otra",
      },
    },
  },
  agregarAlPedido: {
    accion: "mesas.ver",
    tambien: ["cuentas.agregar_linea"],
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: PEDIDO,
        it: "I6: repetir agregarAlPedido con el mismo id deja una línea y un estado de comanda, y devuelve yaExistia",
      },
    },
  },
  liberarMesa: {
    accion: "mesas.ver",
    tambien: ["cuentas.anular"],
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
        it: "I8: cambiar dos veces a la misma mesa es ok (yaExistia) y no audita la segunda; los envíos viejos conservan su rótulo",
      },
    },
  },
  cobrarMesa: {
    accion: "mesas.ver",
    tambien: ["cuentas.cerrar", "tickets.cobrar", "cuentas.anular"],
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: PEDIDO,
        it: "I9: doble clic en cobrar la mesa deja un ticket, un cobro y la mesa libre, y devuelve yaExistia",
      },
    },
  },
  enviarACocina: {
    accion: "mesas.ver",
    tambien: ["comandas.enviar"],
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: PEDIDO,
        it: "I10: doble toque en «Enviar a cocina» con el mismo envío deja un envío y un trabajo, y devuelve yaExistia; sin nada pendiente, NADA_PARA_ENVIAR",
      },
    },
  },
  pedirQueSalga: {
    accion: "mesas.ver",
    tambien: ["comandas.enviar"],
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: PEDIDO,
        it: "I11: repetir «Pedir que salga» con el mismo envío no crea otro; lo que esperaba sale en ese envío",
      },
    },
  },
  anularItemEnviado: {
    accion: "mesas.ver",
    tambien: ["comandas.enviar", "cuentas.anular_linea", "cuentas.agregar_linea"],
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: PEDIDO,
        it: "I12: doble clic en anular un ítem enviado deja una anulación y un aviso; el total cierra",
      },
    },
  },
  unirMesas: {
    accion: "salon.unir",
    tambien: ["cuentas.anular_linea", "cuentas.agregar_linea"],
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: UNION,
        it: "I13: repetir unirMesas con la misma unión deja una sola unión, los ítems una vez y devuelve yaExistia",
      },
    },
  },
  dividirCuenta: {
    accion: "salon.dividir",
    tambien: ["cuentas.abrir", "cuentas.anular_linea", "cuentas.agregar_linea"],
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: DIVISION,
        it: "I14: doble clic en «Confirmar división» deja una sola división, las cuentas hijas una vez y devuelve yaExistia",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
