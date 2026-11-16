/** Parte 3 de 7 de `TEXTOS_DE_FISCAL_PANTALLAS` (`catalogo-fiscal-pantallas.ts`, que la reexporta): se partió para no pasar del tope de líneas. Ninguna clave ni texto cambió. */
export const TEXTOS_DE_FISCAL_PANTALLAS_3 = {
  // El cliente: el consumidor final (PROTO) y el tipo de documento (GUIA: «CUIT o DNI»; CUIL, CDI y Pasaporte: aprobados por
  // el backend en su mensaje del 2026-10-28). Los cinco nombres coinciden letra por letra con `Desc` de la grabación ARCA
  // `test/utilidades/arca-grabaciones/corrida1/012-FEParamGetTiposDoc-respuesta-http200.xml` (CUIT 80, CUIL 86, CDI 87, DNI 96, Pasaporte 94).
  "fiscal.pantalla.consumidor_final": {
    porDefecto: "Consumidor final",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "receptorDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "clienteDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "clienteDeLaRevision",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDelCliente",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "clienteDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "filaDe",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.documento": {
    porDefecto: "{tipo} {numero}",
    marcadores: ["numero", "tipo"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "documentoDe",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.documento_cuit": {
    porDefecto: "CUIT",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "armarLaHoja",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "CLAVE_DE_DOCUMENTO",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "CLAVE_DE_DOCUMENTO",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.documento_cuil": {
    porDefecto: "CUIL",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "CLAVE_DE_DOCUMENTO",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "CLAVE_DE_DOCUMENTO",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.documento_cdi": {
    porDefecto: "CDI",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "CLAVE_DE_DOCUMENTO",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "CLAVE_DE_DOCUMENTO",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.documento_dni": {
    porDefecto: "DNI",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "CLAVE_DE_DOCUMENTO",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "CLAVE_DE_DOCUMENTO",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.documento_pasaporte": {
    porDefecto: "Pasaporte",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "CLAVE_DE_DOCUMENTO",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "CLAVE_DE_DOCUMENTO",
      },
    ],
    fuente: "HEREDADO",
  },

  // Un renglón: «2 × $ 4.500,00 · IVA 21 %» (PROTO).
  "fiscal.pantalla.renglon_cuenta": {
    porDefecto: "{cantidad} × {precio}",
    marcadores: ["cantidad", "precio"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "renglonDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision-de-un-ticket.ts",
        nombre: "vistaDeLaRevisionDeUnTicket",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLaRevision",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "armarElDetalle",
      },
    ],
    fuente: "HEREDADO",
  },
  // La alícuota ({alicuota}: 21, 10,5, 27, 5, 2,5, 0) sale de `Desc` de la grabación ARCA `corrida1/014-FEParamGetTiposIva-respuesta-http200.xml`
  // («21%», «10.5%», «27%», «5%», «2.5%», «0%»): el número coincide; el formato es-AR (coma, espacio antes de «%») es de esta pantalla.
  "fiscal.pantalla.renglon_iva": {
    porDefecto: "IVA {alicuota} %",
    marcadores: ["alicuota"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "renglonDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "totalesDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "nombreDeLaFila",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "armarElDetalle",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/pedido-de-anulacion.ts",
        nombre: "descripcionDelRenglon",
      },
    ],
    fuente: "HEREDADO",
  },

  // Lo ya anulado: CONTRATO D-29 «Ya anulado con notas de crédito» y CONTRATO «Se muestra "Sin notas"».
  "fiscal.pantalla.ya_anulado": {
    porDefecto: "Ya anulado con notas de crédito",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "anuladoDe",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.sin_notas": {
    porDefecto: "Sin notas",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "anuladoDe",
      },
    ],
    fuente: "HEREDADO",
  },
} as const;
