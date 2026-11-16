/** Parte 1 de 7 de `TEXTOS_DE_FISCAL_PANTALLAS` (`catalogo-fiscal-pantallas.ts`, que la reexporta): se partió para no pasar del tope de líneas. Ninguna clave ni texto cambió. */
export const TEXTOS_DE_FISCAL_PANTALLAS_1 = {
  // PROTO: <title>Comprobante</title>.
  "fiscal.pantalla.titulo": {
    porDefecto: "Comprobante",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/facturacion/comprobantes/[id]/page.tsx",
        nombre: "OPCIONES",
      },
    ],
    fuente: "HEREDADO",
  },

  // Qué es el comprobante: «Factura B 0001-00001234» (CONTRATO: «Título "Factura B 0001-00001234"»; GUIA: «Corresponde a
  // Factura B 0001-00000042 del 14/10/2026»; «nota de crédito» y «nota de débito» en GUIA, en minúscula dentro de una frase).
  "fiscal.pantalla.tipo_factura": {
    porDefecto: "Factura",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "armarLosFiltros",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "claveDeClase",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.tipo_nota_de_credito": {
    porDefecto: "Nota de crédito",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "claveDeClase",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.tipo_nota_de_debito": {
    porDefecto: "Nota de débito",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "claveDeClase",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.comprobante_con_numero": {
    porDefecto: "{tipo} {letra} {numero}",
    marcadores: ["letra", "numero", "tipo"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "armarLaHoja",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "nombreDe",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.comprobante_sin_numero": {
    porDefecto: "{tipo} {letra}",
    marcadores: ["letra", "tipo"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "armarLosFiltros",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "nombreDe",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.corresponde_a": {
    porDefecto: "Corresponde a {comprobante} del {fecha}",
    largoMaximo: 120,
    marcadores: ["comprobante", "fecha"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "armarLaHoja",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "armarElDetalle",
      },
    ],
    fuente: "HEREDADO",
  },

  // Los siete estados de un comprobante (D-25). CONTRATO D-25: «Pendiente = Pendiente de enviar; En validación = Validando;
  // Autorizado = Autorizada; Rechazado = Rechazada; Incierto = Confirmando; Conflicto = Requiere revisión; Descartado =
  // Descartada».
  "fiscal.pantalla.estado_pendiente": {
    porDefecto: "Pendiente de enviar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "CLAVE_DE_ESTADO_DEL_FILTRO",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "CLAVE_DE_ESTADO",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.estado_en_validacion": {
    porDefecto: "Validando",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "CLAVE_DE_ESTADO_DEL_FILTRO",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "CLAVE_DE_ESTADO",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.estado_autorizado": {
    porDefecto: "Autorizada",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "CLAVE_DE_ESTADO_DEL_FILTRO",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "CLAVE_DE_ESTADO",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.estado_rechazado": {
    porDefecto: "Rechazada",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "CLAVE_DE_ESTADO_DEL_FILTRO",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "CLAVE_DE_ESTADO",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.estado_incierto": {
    porDefecto: "Confirmando",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "CLAVE_DE_ESTADO_DEL_FILTRO",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "CLAVE_DE_ESTADO",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.estado_conflicto": {
    porDefecto: "Requiere revisión",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "CLAVE_DE_ESTADO_DEL_FILTRO",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "CLAVE_DE_ESTADO",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.estado_descartado": {
    porDefecto: "Descartada",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "CLAVE_DE_ESTADO_DEL_FILTRO",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "CLAVE_DE_ESTADO",
      },
    ],
    fuente: "HEREDADO",
  },

  // La etiqueta junto al estado «Autorizada». CONTRATO D-29: «Anulación parcial» o «Anulación total».
  "fiscal.pantalla.anulacion_parcial": {
    porDefecto: "Anulación parcial",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "anulacionDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/pedido-de-anulacion.ts",
        nombre: "descripcionDelRenglon",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anulacion_total": {
    porDefecto: "Anulación total",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "anulacionDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/pedido-de-anulacion.ts",
        nombre: "descripcionDelRenglon",
      },
    ],
    fuente: "HEREDADO",
  },
} as const;
