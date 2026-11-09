import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const ARCHIVO = "test/integracion/catalogo-casos-de-uso.test.ts";
const ARCHIVO_DE_FORMA = "test/integracion/catalogo-forma-de-venta.test.ts";

/**
 * Los casos de uso del catálogo (E2 mínimo §3.5) y la acción que cada uno exige al guard (cruce X1 de ADR-003), con cómo se repite sin
 * duplicar (ADR-015 §4) y la prueba que lo fija. `cambiarFormaDeVenta` exige además `productos.editar` y `editarOpciones` exige además
 * `variantes.editar` cuando toca la variante: se piden dentro del caso con `exigirAcciones`; acá va la acción principal.
 */
export const DECLARACIONES = {
  crearProducto: {
    accion: "productos.crear",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_FORMA,
        it: "I2: repetir crearProducto con el mismo id deja un producto y devuelve yaExistia; con otro contenido, ID_REUTILIZADO",
      },
    },
  },
  crearProductoRapido: {
    accion: "productos.crear",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_FORMA,
        it: "I2: repetir crearProductoRapido con el mismo id deja un producto y devuelve yaExistia; con otro contenido, ID_REUTILIZADO",
      },
    },
  },
  editarProducto: {
    accion: "productos.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO_DE_FORMA,
        it: "idempotente: repetir editarProducto ya aplicado devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar",
      },
    },
  },
  desactivarProducto: {
    accion: "productos.desactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_FORMA,
        it: "I5: desactivar dos veces es ok, no escribe ni audita la segunda",
      },
    },
  },
  reactivarProducto: {
    accion: "productos.reactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_FORMA,
        it: "I5: reactivar dos veces es ok, no escribe ni audita la segunda",
      },
    },
  },
  cambiarFormaDeVenta: {
    accion: "productos.cambiar_precio",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO_DE_FORMA,
        it: "D10: repetir cambiarFormaDeVenta ya aplicado es SIN_CAMBIOS y no escribe",
      },
    },
  },
  cambiarPrecio: {
    accion: "productos.cambiar_precio",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO,
        it: "I1: doble clic en Guardar precio: el mismo precioId dos veces deja una fila; con otro precio, ID_REUTILIZADO",
      },
    },
  },
  editarOpciones: {
    accion: "opciones.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO,
        it: "I3: reenviar editarOpciones después de un éxito es SIN_CAMBIOS: devuelve lo vigente y no inserta versiones",
      },
    },
  },
  guardarConsumoDeGrupo: {
    accion: "opciones.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO,
        it: "I3: reenviar guardarConsumoDeGrupo después de un éxito es SIN_CAMBIOS y no inserta versiones",
      },
    },
  },
  copiarOpciones: {
    accion: "opciones.editar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO,
        it: "I4: doble clic en Copiar (mismo copiaId) copia una vez y devuelve yaExistia",
      },
    },
  },
  crearSeccionDeCarta: {
    accion: "productos.editar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO,
        it: "secciones: repetir crearSeccionDeCarta con el mismo id deja una sección",
      },
    },
  },
  editarSeccionDeCarta: {
    accion: "productos.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO,
        it: "secciones: repetir editarSeccionDeCarta ya aplicada devuelve lo vigente sin escribir",
      },
    },
  },
  desactivarSeccionDeCarta: {
    accion: "productos.editar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO,
        it: "secciones: desactivar dos veces es ok y no audita la segunda",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
