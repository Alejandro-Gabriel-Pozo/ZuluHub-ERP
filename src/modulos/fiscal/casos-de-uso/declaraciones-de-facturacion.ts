import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

/**
 * Los casos de uso de facturación (spec H7 facturación §B.4 y §C) y la acción que cada uno exige al guard (cruce
 * X1 de ADR-003). Una acción por caso: por eso la nota de crédito y la de débito son dos casos (la NC es
 * `notas_de_credito.emitir`, CC; la ND, como la factura, `comprobantes.emitir_manual`, CA), con el mismo cuerpo.
 *
 * Los dos trabajos corren sin persona (ADR-007): el permiso se exigió al emitir (`comprobantes.emitir_manual` o
 * `notas_de_credito.emitir`) y el comprobante ya es una intención confirmada; el trabajo solo la lleva a ARCA.
 */
export const DECLARACIONES_DE_FACTURACION = {
  emitirComprobanteManual: {
    accion: "comprobantes.emitir_manual",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/facturacion-casos.test.ts",
        it: "la misma clave con el mismo pedido devuelve el mismo comprobante (yaExistia) sin escribir nada más",
      },
    },
  },
  // Facturar un documento ya cobrado que armó otro módulo (E1): `comprobantes.emitir` (COMPLETA_CIERRA), no la acción de la factura libre.
  emitirFacturaDeOrigen: {
    accion: "comprobantes.emitir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/facturacion-factura-de-origen.test.ts",
        it: "el mismo origen con el mismo pedido devuelve la misma factura (yaExistia) sin escribir ni encolar nada más",
      },
    },
  },
  emitirNotaDeCredito: {
    accion: "notas_de_credito.emitir",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/facturacion-acreditado.test.ts",
        it: "emitir la misma nota con la misma clave devuelve la misma nota y lo acreditado no se duplica",
      },
    },
  },
  emitirNotaDeDebito: {
    accion: "comprobantes.emitir_manual",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/facturacion-acreditado.test.ts",
        it: "emitir la misma nota de débito con la misma clave devuelve la misma nota y no duplica filas, auditoría ni trabajo",
      },
    },
  },
  descartarComprobante: {
    accion: "comprobantes.descartar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/facturacion-casos.test.ts",
        it: "descartar un PENDIENTE con motivo; dos veces «ya estaba»; el trabajo después no envía",
      },
    },
  },
  // `YA_ESTABA` solo mientras el comprobante siga `PENDIENTE` con su trabajo de validación vivo (`encolado: false`, sin auditar); con el
  // trabajo ya terminado, reintentar encola el siguiente y audita (`descartar-y-reintentar.ts`). La prueba fija las dos mitades.
  reintentarComprobante: {
    accion: "comprobantes.reintentar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/facturacion-casos.test.ts",
        it: "reintentar un PENDIENTE con trabajo vivo no encola otro; con el trabajo FALLIDO encola el siguiente",
      },
    },
  },
  // La segunda llamada encuentra la serie ya `LIBRE` y da `SERIE_NO_BLOQUEADA` sin escribir (spec H7 facturación §B.4.6 y
  // `resincronizar-y-ambiente.ts`): no hay «ya estaba». La fija la tercera aserción de `resincronizarSerie` de esta prueba.
  resincronizarSerie: {
    accion: "series.resincronizar",
    repeticion: {
      regla: "RECHAZA_LA_REPETICION",
      prueba: {
        archivo: "test/integracion/facturacion-casos.test.ts",
        it: "otro sistema usó el número: CONFLICTO y serie BLOQUEADA; resincronizar y reintentar lo emite con el siguiente",
      },
    },
  },
  cambiarAmbienteDePuntoDeVenta: {
    accion: "puntos_de_venta.cambiar_ambiente",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/fiscal-cableado-web.test.ts",
        it: "la misma entrada dos o tres veces: la primera cambia; las otras son «ya estaba» (éxito), sin escribir ni auditar",
      },
    },
  },
  validarComprobante: {
    sinGuard:
      "Trabajo de sistema (ADR-007): el permiso se exigió al emitir (comprobantes.emitir_manual o notas_de_credito.emitir) y el comprobante ya es una intención confirmada; el trabajo solo la lleva a ARCA",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/facturacion-casos.test.ts",
        it: "repetir la validación de un comprobante ya enviado no hace nada: NADA_QUE_VALIDAR, sin reenviar a ARCA ni escribir ni auditar de nuevo",
      },
    },
  },
  reconciliarComprobantes: {
    sinGuard:
      "Trabajo de sistema (ADR-007): resuelve consultando a ARCA los comprobantes de la empresa del trabajo que quedaron en vuelo, y reencola los pendientes sin trabajo; no decide nada que una persona haya pedido",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/facturacion-casos.test.ts",
        it: "repetir la reconciliación de un comprobante que ya se resolvió no encuentra nada en vuelo: sin consultar a ARCA, escribir ni auditar de nuevo",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
