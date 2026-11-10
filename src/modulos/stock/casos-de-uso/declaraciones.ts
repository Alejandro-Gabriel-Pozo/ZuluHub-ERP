import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const ARCHIVO_DE_DEPOSITOS = "test/integracion/stock-depositos.test.ts";

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
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
