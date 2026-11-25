import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const ARCHIVO_DE_FICHA = "test/integracion/compras-ficha.test.ts";
const ARCHIVO_DE_FACTURA = "test/integracion/compras-factura.test.ts";
const ARCHIVO_DE_PAGOS = "test/integracion/compras-pagos.test.ts";
const ARCHIVO_DE_RECEPCION = "test/integracion/compras-recepcion.test.ts";
const ARCHIVO_DE_RECEPCION_SEPARADA = "test/integracion/compras-n3-recepcion.test.ts";
const ARCHIVO_DE_CONCILIACION_SEPARADA = "test/integracion/compras-n3-conciliacion.test.ts";
const ARCHIVO_DE_ORDENES = "test/integracion/compras-n4-ordenes.test.ts";
const ARCHIVO_DE_DIFERENCIAS = "test/integracion/compras-n4-diferencias.test.ts";
const ARCHIVO_DE_NOTAS = "test/integracion/compras-n4-notas-de-credito.test.ts";
const ARCHIVO_DE_DEVOLUCIONES = "test/integracion/compras-n4-devoluciones.test.ts";

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
  registrarRecepcion: {
    accion: "recepciones.registrar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_RECEPCION_SEPARADA,
        it: "I1: la misma recepción dos veces (misma clave) deja una sola pendiente y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA",
      },
    },
  },
  crearOrden: {
    accion: "ordenes_de_compra.crear",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_ORDENES,
        it: "I1: la misma orden dos veces (misma clave) deja un solo borrador y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA",
      },
    },
  },
  editarOrden: {
    accion: "ordenes_de_compra.crear",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO_DE_ORDENES,
        it: "I2: editar dos veces con el mismo contenido deja una sola edición: la segunda devuelve sinCambios sin escribir ni auditar",
      },
    },
  },
  pedirOrden: {
    accion: "ordenes_de_compra.pedir",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_ORDENES,
        it: "I3: pedir dos veces la misma orden deja un solo número y la segunda devuelve yaEstaba sin escribir ni auditar",
      },
    },
  },
  cerrarOrden: {
    accion: "ordenes_de_compra.cerrar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_ORDENES,
        it: "I4: cerrar dos veces la misma orden devuelve el mismo motivo y la segunda no escribe ni audita",
      },
    },
  },
  anularOrden: {
    accion: "ordenes_de_compra.anular",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_ORDENES,
        it: "I5: anular dos veces la misma orden devuelve yaEstaba y la segunda no escribe ni audita",
      },
    },
  },
  configurarTolerancias: {
    accion: "compras.configurar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO_DE_DIFERENCIAS,
        it: "I7: fijar dos veces las mismas tolerancias deja una sola escritura: la segunda devuelve sinCambios sin escribir ni auditar",
      },
    },
  },
  resolverDiferencia: {
    accion: "diferencias_de_compra.resolver",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_DIFERENCIAS,
        it: "I8: resolver dos veces la misma diferencia con lo mismo devuelve yaEstaba y la segunda no escribe ni audita",
      },
    },
  },
  devolverAlProveedor: {
    accion: "devoluciones_a_proveedor.registrar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_DEVOLUCIONES,
        it: "I1: la misma devolución dos veces (misma clave) deja una sola salida de stock y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA",
      },
    },
  },
  anularDevolucion: {
    accion: "devoluciones_a_proveedor.anular",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_DEVOLUCIONES,
        it: "I2: anular dos veces la misma devolución devuelve yaEstaba y la segunda no escribe ni audita",
      },
    },
  },
  registrarNotaDeCredito: {
    accion: "notas_de_credito_de_proveedor.registrar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_NOTAS,
        it: "I1: la misma nota dos veces (misma clave) deja una sola nota y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA",
      },
    },
  },
  anularNotaDeCredito: {
    accion: "notas_de_credito_de_proveedor.anular",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_NOTAS,
        it: "I2: anular dos veces la misma nota devuelve yaEstaba y la segunda no escribe ni audita",
      },
    },
  },
  confirmarRecepcion: {
    accion: "recepciones.confirmar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_RECEPCION_SEPARADA,
        it: "I2: confirmar dos veces la misma recepción deja una entrada de stock y la segunda devuelve yaExistia sin escribir ni auditar",
      },
    },
  },
  anularRecepcionPendiente: {
    accion: "recepciones.anular",
    repeticion: {
      regla: "RECHAZA_LA_REPETICION",
      prueba: {
        archivo: ARCHIVO_DE_RECEPCION_SEPARADA,
        it: "I3: anular dos veces una pendiente: la segunda es RECEPCION_YA_ANULADA y no escribe; una confirmada no se anula por acá; una anulada no se confirma",
      },
    },
  },
  registrarFactura: {
    accion: "comprobantes_de_proveedor.registrar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_CONCILIACION_SEPARADA,
        it: "I1: la misma factura dos veces (misma clave) deja un solo comprobante y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA; la misma factura con otra clave, COMPROBANTE_YA_REGISTRADO",
      },
    },
  },
  anularFactura: {
    accion: "comprobantes_de_proveedor.anular",
    repeticion: {
      regla: "RECHAZA_LA_REPETICION",
      prueba: {
        archivo: ARCHIVO_DE_CONCILIACION_SEPARADA,
        it: "I4: anular dos veces una factura sola es COMPROBANTE_ANULADO y no escribe; con conciliaciones vivas o con un pago vigente no se anula",
      },
    },
  },
  conciliarFactura: {
    accion: "conciliaciones.conciliar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_CONCILIACION_SEPARADA,
        it: "I2: la misma conciliación dos veces (misma clave) deja una sola y devuelve yaExistia; con otras asignaciones, CLAVE_REUTILIZADA",
      },
    },
  },
  anularConciliacion: {
    accion: "conciliaciones.anular",
    repeticion: {
      regla: "RECHAZA_LA_REPETICION",
      prueba: {
        archivo: ARCHIVO_DE_CONCILIACION_SEPARADA,
        it: "I3: anular dos veces una conciliación deja un solo espejo y la segunda es CONCILIACION_YA_ANULADA; las líneas recuperan su saldo",
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
  exportarCompras: {
    accion: "compras.exportar",
    // Exportar mira muchas compras y trae importes: además de la acción propia exige las dos de ver compras y los costos (dueño, 25/11/2026, pregunta 4).
    tambien: ["recepciones.ver", "comprobantes_de_proveedor.ver", "costos.ver"],
    repeticion: {
      regla: "NO_APLICA",
      motivo:
        "Es una lectura: repetirla devuelve lo mismo y no duplica nada de compras, pagos ni stock; cada exportación deja su propio registro de auditoría (quién, cuándo, período y cantidad de filas).",
      prueba: {
        archivo: "test/integracion/compras-exportacion.test.ts",
        it: "I6: exportar dos veces el mismo período da las mismas filas, deja dos registros de auditoría sin los datos y no cambia ninguna tabla de compras",
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
  corregirLoRecibido: {
    accion: "compras.corregir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/compras-correccion-recibido.test.ts",
        it: "I1: la misma corrección dos veces (misma clave) deja una sola fila y un solo movimiento y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA",
      },
    },
  },
  tomarElCosto: {
    accion: "compras.corregir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/compras-tomar-el-costo.test.ts",
        it: "I1: tomar el costo dos veces (misma clave) deja una sola corrección y un solo ajuste y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
