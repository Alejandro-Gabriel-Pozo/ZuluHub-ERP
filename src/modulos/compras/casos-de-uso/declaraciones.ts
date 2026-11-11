import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const ARCHIVO_DE_FICHA = "test/integracion/compras-ficha.test.ts";
const ARCHIVO_DE_FACTURA = "test/integracion/compras-factura.test.ts";
const ARCHIVO_DE_PAGOS = "test/integracion/compras-pagos.test.ts";
const ARCHIVO_DE_RECEPCION = "test/integracion/compras-recepcion.test.ts";

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
  registrarCompra: {
    accion: "recepciones.registrar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_RECEPCION,
        it: "I1: la misma compra dos veces (misma clave) deja una compra y una entrada de stock y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA",
      },
    },
  },
  registrarCompraConFactura: {
    accion: "comprobantes_de_proveedor.registrar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_FACTURA,
        it: "I1: repetir la compra con factura devuelve lo mismo (comprobante y avisos) sin escribir; con otra factura y la misma clave, CLAVE_REUTILIZADA",
      },
    },
  },
  anularCompra: {
    accion: "recepciones.anular",
    repeticion: {
      regla: "RECHAZA_LA_REPETICION",
      prueba: {
        archivo: ARCHIVO_DE_RECEPCION,
        it: "I7: anular dos veces la misma compra deja un solo espejo y la segunda da RECEPCION_YA_ANULADA",
      },
    },
  },
  configurarCompras: {
    accion: "compras.configurar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO_DE_RECEPCION,
        it: "configurarCompras con el nivel que ya está devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar",
      },
    },
  },
  declararPago: {
    accion: "comprobantes_de_proveedor.pagar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_PAGOS,
        it: "I5: el mismo pago dos veces (misma clave) deja un pago y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA",
      },
    },
  },
  anularPago: {
    accion: "comprobantes_de_proveedor.anular_pago",
    repeticion: {
      regla: "RECHAZA_LA_REPETICION",
      prueba: {
        archivo: ARCHIVO_DE_PAGOS,
        it: "I5: anular dos veces el mismo pago deja un solo espejo y la segunda da PAGO_YA_ANULADO; después se puede declarar otro",
      },
    },
  },
  corregirCompra: {
    accion: "compras.corregir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/compras-correcciones.test.ts",
        it: "I6: la misma corrección dos veces (misma clave) deja una sola fila, un solo ajuste de costo y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
