import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const ARCHIVO = "test/integracion/catalogo-casos-de-uso.test.ts";
const ARCHIVO_DE_PRESENTACIONES = "test/integracion/catalogo-presentaciones.test.ts";
const ARCHIVO_DE_CARTA = "test/integracion/carta-publica-casos-de-uso.test.ts";
const ARCHIVO_DE_CLASIFICACION = "test/integracion/clasificacion-casos-de-uso.test.ts";
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
        archivo: ARCHIVO,
        it: "I2: repetir crearProducto con el mismo id deja un producto y devuelve yaExistia; con otro contenido, ID_REUTILIZADO",
      },
    },
  },
  crearProductoRapido: {
    accion: "productos.crear",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO,
        it: "I2: repetir crearProductoRapido con el mismo id deja un producto y devuelve yaExistia; con otro contenido, ID_REUTILIZADO",
      },
    },
  },
  editarProducto: {
    accion: "productos.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO,
        it: "idempotente: repetir editarProducto ya aplicado devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar",
      },
    },
  },
  desactivarProducto: {
    accion: "productos.desactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO,
        it: "I5: desactivar dos veces es ok, no escribe ni audita la segunda",
      },
    },
  },
  reactivarProducto: {
    accion: "productos.reactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO,
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
        it: "secciones: desactivar dos veces es ok y no audita la segunda; el producto elige una sección activa y desactivarla no lo toca",
      },
    },
  },
  reactivarSeccionDeCarta: {
    accion: "productos.editar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_CARTA,
        it: "L-7: desactivar y reactivar una sección devuelve sus productos a la carta sin editar ninguno; repetir cada una es yaEstaba",
      },
    },
  },
  reordenarSeccionesDeCarta: {
    accion: "productos.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO_DE_CARTA,
        it: "C-4: repetir el reordenamiento ya aplicado es SIN_CAMBIOS: no sube ninguna versión ni audita, aunque las versiones sean viejas",
      },
    },
  },
  clasificarProducto: {
    accion: "productos.editar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_CLASIFICACION,
        it: "clasificar: repetir con el mismo id deja un vínculo y una auditoría; con otro producto o nodo, ID_REUTILIZADO",
      },
    },
  },
  crearNodoDeClasificacion: {
    accion: "productos.editar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_CLASIFICACION,
        it: "crear: repetir con el mismo id deja un nodo y una auditoría; con otro contenido, ID_REUTILIZADO",
      },
    },
  },
  renombrarNodoDeClasificacion: {
    accion: "productos.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO_DE_CLASIFICACION,
        it: "renombrar: repetir con el mismo nombre devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar",
      },
    },
  },
  moverNodoDeClasificacion: {
    accion: "productos.editar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_CLASIFICACION,
        it: "mover: repetir el movimiento ya aplicado es yaEstaba, aunque la versión esperada sea vieja, sin escribir ni auditar",
      },
    },
  },
  desactivarNodoDeClasificacion: {
    accion: "productos.editar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_CLASIFICACION,
        it: "desactivar y reactivar: repetir cada uno es yaEstaba y no audita la segunda vez",
      },
    },
  },
  reactivarNodoDeClasificacion: {
    accion: "productos.editar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_CLASIFICACION,
        it: "desactivar y reactivar: repetir cada uno es yaEstaba y no audita la segunda vez",
      },
    },
  },
  guardarCartaPublica: {
    accion: "vidrieras.editar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_CARTA,
        it: "C-1: guardarCartaPublica con el mismo id dos veces deja UNA carta, un solo código y una entrada de auditoría; la segunda es yaExistia",
      },
    },
  },
  ocultarProducto: {
    accion: "vidrieras.marcar_disponibilidad",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_CARTA,
        it: "D-4: ocultar dos veces deja una fila y la segunda es yaEstaba sin auditar; true, false, false deja el producto visible",
      },
    },
  },
  crearPresentacion: {
    accion: "productos.editar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_PRESENTACIONES,
        it: "I8: crear dos veces la misma presentación devuelve la existente; con otra cantidad, PRESENTACION_REPETIDA",
      },
    },
  },
  editarPresentacion: {
    accion: "productos.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO_DE_PRESENTACIONES,
        it: "I8: editar una presentación con lo que ya tiene devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
