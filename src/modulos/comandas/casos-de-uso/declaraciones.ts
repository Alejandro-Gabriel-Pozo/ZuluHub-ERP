import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const ENVIOS = "test/integracion/comandas-envios.test.ts";
const IMPRESION = "test/integracion/comandas-impresion.test.ts";

/**
 * Los casos de uso de comandas (E7 §3.5) y la acción que cada uno exige al guard (cruce X1 de ADR-003), con cómo se repite sin duplicar (ADR-015 §4) y la
 * prueba que lo fija. `accion` es la del módulo (X1) y `tambien` las de ventas que usa por dentro (decisión 155: los tres roles): `anularItemEnviado` anula la línea Y agrega el
 * resto, así que exige las dos, como su puerta del salón; `quitarSinEnviar`, `cuentas.anular_linea`; `cambiarSalida`, `cuentas.agregar_linea`. El caso las lee de acá
 * (`accionesDeCaso`): declaración y guard son la misma lista (`guard-primero-de-salon-y-comandas.test.ts`).
 */
export const DECLARACIONES = {
  enviarACocina: {
    accion: "comandas.enviar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ENVIOS,
        it: "P2: el doble toque en «Enviar a cocina» (mismo envío y misma clave) es un solo envío y un solo papel; otro toque sin nada pendiente, NADA_PARA_ENVIAR",
      },
    },
  },
  pedirQueSalga: {
    accion: "comandas.enviar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ENVIOS,
        it: "pedir que salga es un envío más: repetirlo con la misma clave no lo duplica y lo ya enviado se ignora con aviso",
      },
    },
  },
  anularItemEnviado: {
    accion: "comandas.enviar",
    tambien: ["cuentas.anular_linea", "cuentas.agregar_linea"],
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ENVIOS,
        it: "P12: anular parte de un ítem enviado con el precio del catálogo cambiado: el resto conserva el precio congelado, un aviso y una anulación, y el doble clic no duplica",
      },
    },
  },
  quitarSinEnviar: {
    accion: "comandas.enviar",
    tambien: ["cuentas.anular_linea"],
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ENVIOS,
        it: "quitar un plato sin enviar es libre y repetirlo devuelve yaEstabaQuitada; con el plato enviado, LINEA_YA_ENVIADA",
      },
    },
  },
  cambiarSalida: {
    accion: "comandas.enviar",
    tambien: ["cuentas.agregar_linea"],
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ENVIOS,
        it: "cambiar «sale después» solo vale sin enviar; repetir la misma salida no cambia nada",
      },
    },
  },
  registrarImpresora: {
    accion: "impresoras.crear",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: IMPRESION,
        it: "guardar dos veces la misma impresora es una sola; el nombre es único por sucursal",
      },
    },
  },
  editarImpresora: {
    accion: "impresoras.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: IMPRESION,
        it: "editar una impresora con lo mismo no cambia nada; con una versión vieja, VERSION_DESACTUALIZADA",
      },
    },
  },
  desactivarImpresora: {
    accion: "impresoras.desactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: IMPRESION,
        it: "desactivar una impresora dos veces es lo mismo y no se borra",
      },
    },
  },
  solicitarImpresion: {
    accion: "impresiones.imprimir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: IMPRESION,
        it: "P11: imprimir dos veces seguidas es UN trabajo; reintentar es el mismo trabajo con un intento más",
      },
    },
  },
  solicitarCopia: {
    accion: "impresiones.reimprimir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: IMPRESION,
        it: "una copia es un trabajo nuevo con su clave: repetir la misma clave devuelve el mismo trabajo y no toca la cuenta",
      },
    },
  },
  declararResultadoDeImpresion: {
    accion: "impresiones.imprimir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: IMPRESION,
        it: "declarar dos veces el mismo resultado de un intento es lo mismo; otro distinto, RESULTADO_YA_DECLARADO",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
