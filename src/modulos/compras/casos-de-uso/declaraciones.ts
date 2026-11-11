import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const ARCHIVO_DE_FICHA = "test/integracion/compras-ficha.test.ts";

/**
 * Los casos de uso de compras (E9 §3.2 a §3.6) y la acción que cada uno exige al guard (cruce X1 de ADR-003), con cómo se repite sin duplicar (ADR-015 §4) y la
 * prueba que lo fija. El `satisfies` de `casos-de-uso.ts` exige que los casos de uso sean EXACTAMENTE los declarados. Los compuestos exigen además las acciones del
 * módulo que usan (`stock.*`, `partes.*`): la declaración lista la propia.
 */
export const DECLARACIONES = {
  agregarPuntoDeVenta: {
    accion: "proveedores.editar_ficha",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_FICHA,
        it: "I8: agregar dos veces el mismo punto de venta o comprobante, o dejar de usar uno ya apagado, es ok y la segunda no escribe ni audita",
      },
    },
  },
  dejarDeUsarPuntoDeVenta: {
    accion: "proveedores.editar_ficha",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_FICHA,
        it: "I8: agregar dos veces el mismo punto de venta o comprobante, o dejar de usar uno ya apagado, es ok y la segunda no escribe ni audita",
      },
    },
  },
  agregarComprobante: {
    accion: "proveedores.editar_ficha",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_FICHA,
        it: "I8: agregar dos veces el mismo punto de venta o comprobante, o dejar de usar uno ya apagado, es ok y la segunda no escribe ni audita",
      },
    },
  },
  dejarDeUsarComprobante: {
    accion: "proveedores.editar_ficha",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_FICHA,
        it: "I8: agregar dos veces el mismo punto de venta o comprobante, o dejar de usar uno ya apagado, es ok y la segunda no escribe ni audita",
      },
    },
  },
  pedirPuntoDeVenta: {
    accion: "proveedores.pedir_ficha",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_FICHA,
        it: "I8: el mismo pedido de ficha dos veces es un solo pedido pendiente",
      },
    },
  },
  pedirComprobante: {
    accion: "proveedores.pedir_ficha",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_FICHA,
        it: "I8: el mismo pedido de ficha dos veces es un solo pedido pendiente",
      },
    },
  },
  resolverPedido: {
    accion: "proveedores.editar_ficha",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_FICHA,
        it: "I8: aprobar dos veces el mismo pedido es ok y la segunda no escribe ni audita; en sentido contrario, PEDIDO_YA_RESUELTO",
      },
    },
  },
  crearPresentacion: {
    accion: "productos.editar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_FICHA,
        it: "I8: crear dos veces la misma presentación devuelve la existente; con otra cantidad, PRESENTACION_REPETIDA",
      },
    },
  },
  editarPresentacion: {
    accion: "productos.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO_DE_FICHA,
        it: "I8: editar una presentación con lo que ya tiene devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
