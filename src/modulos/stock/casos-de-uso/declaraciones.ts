import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const ARCHIVO_DE_DEPOSITOS = "test/integracion/stock-depositos.test.ts";
const ARCHIVO_DE_IDEMPOTENCIA = "test/integracion/stock-idempotencia.test.ts";
const ARCHIVO_DE_CONTEOS = "test/integracion/stock-conteos.test.ts";
const ARCHIVO_DE_COMPOSICIONES = "test/integracion/stock-composiciones.test.ts";

/**
 * Los casos de uso de stock (E5 §3.2) y la acción que cada uno exige al guard (cruce X1 de ADR-003), con cómo se repite sin duplicar
 * (ADR-015 §4) y la prueba que lo fija. Cada tramo suma los suyos acá (movimientos, conteos, composiciones): el `satisfies` de
 * `casos-de-uso.ts` exige que los casos de uso sean EXACTAMENTE los declarados.
 */
export const DECLARACIONES = {
  // ---- depósitos (E5-T4) ----
  crearDeposito: {
    accion: "depositos.crear",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_DEPOSITOS,
        it: "I1: repetir crearDeposito con el mismo id deja un depósito y devuelve yaExistia; con otro contenido, ID_REUTILIZADO",
      },
    },
  },
  editarDeposito: {
    accion: "depositos.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO_DE_DEPOSITOS,
        it: "I2: repetir editarDeposito ya aplicado devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar",
      },
    },
  },
  desactivarDeposito: {
    accion: "depositos.desactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_DEPOSITOS,
        it: "I3: desactivar dos veces es ok, no escribe ni audita la segunda",
      },
    },
  },
  reactivarDeposito: {
    accion: "depositos.reactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_DEPOSITOS,
        it: "I3: reactivar dos veces es ok, no escribe ni audita la segunda",
      },
    },
  },
  // ---- artículos (E5-T4) ----
  controlarArticulo: {
    accion: "articulos.controlar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_DEPOSITOS,
        it: "I4: controlar dos veces el mismo producto deja un artículo, devuelve yaExistia y no audita la segunda",
      },
    },
  },
  dejarDeControlar: {
    accion: "articulos.dejar_de_controlar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_DEPOSITOS,
        it: "I4: dejar de controlar dos veces es ok y no audita la segunda",
      },
    },
  },
  // ---- movimientos (E5-T5): la clave de la pantalla (UUID) con la huella del contenido; la misma clave con otra huella, CLAVE_REUTILIZADA ----
  registrarEntrada: {
    accion: "stock.registrar_entrada",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_IDEMPOTENCIA,
        it: "P7: la misma entrada dos veces (clic doble, misma clave) deja una sola entrada, devuelve yaExistia y el saldo sube una vez",
      },
    },
  },
  registrarSalida: {
    accion: "stock.registrar_salida",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_IDEMPOTENCIA,
        it: "I5: repetir registrarSalida con la misma clave devuelve yaExistia sin escribir ni volver a auditar la excepción",
      },
    },
  },
  transferir: {
    accion: "stock.transferir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_IDEMPOTENCIA,
        it: "I6: repetir transferir con la misma clave mueve una sola vez",
      },
    },
  },
  ajustar: {
    accion: "stock.ajustar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_IDEMPOTENCIA,
        it: "I7: repetir ajustar con la misma clave ajusta una sola vez",
      },
    },
  },
  anularMovimiento: {
    accion: "stock.anular",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_IDEMPOTENCIA,
        it: "P11: anular dos veces el mismo movimiento deja un solo espejo, y anular una anulación se rechaza",
      },
    },
  },
  // ---- conteo físico (E5-T6): abrir y registrar llevan el `id` de la pantalla; aplicar y cancelar se repiten por el estado del conteo ----
  abrirConteo: {
    accion: "conteos.abrir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_CONTEOS,
        it: "I8: repetir abrirConteo con el mismo id devuelve yaExistia y deja un solo conteo; con otro depósito, ID_REUTILIZADO",
      },
    },
  },
  registrarConteo: {
    accion: "conteos.registrar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_CONTEOS,
        it: "I9: repetir registrarConteo con el mismo id deja un solo registro y devuelve yaExistia; con otro contenido, ID_REUTILIZADO",
      },
    },
  },
  aplicarConteo: {
    accion: "conteos.aplicar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_CONTEOS,
        it: "P12: aplicar el mismo conteo dos veces deja un solo ajuste y devuelve yaAplicado con el mismo movimiento",
      },
    },
  },
  cancelarConteo: {
    accion: "conteos.cancelar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_CONTEOS,
        it: "I10: cancelar dos veces es ok y no audita la segunda",
      },
    },
  },
  // ---- composiciones (E5-T7): el pedido fija el conjunto final; el mismo contenido (o la receta ya retirada) se repite sin escribir ----
  guardarComposicion: {
    accion: "composiciones.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO_DE_COMPOSICIONES,
        it: "I11: repetir guardarComposicion con el mismo contenido devuelve la versión vigente con yaExistia, sin versión nueva ni auditoría, aunque la versión esperada sea vieja",
      },
    },
  },
  retirarComposicion: {
    accion: "composiciones.editar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_COMPOSICIONES,
        it: "I12: retirar dos veces la receta es ok y no escribe ni audita la segunda",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
