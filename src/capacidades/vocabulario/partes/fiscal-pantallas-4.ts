/** Parte 4 de 7 de `TEXTOS_DE_FISCAL_PANTALLAS` (`catalogo-fiscal-pantallas.ts`, que la reexporta): se partió para no pasar del tope de líneas. Ninguna clave ni texto cambió. */
export const TEXTOS_DE_FISCAL_PANTALLAS_4 = {
  // Los avisos por estado. «Validando con ARCA…» GUIA §1.2 y PROTO; «Todavía no tiene número.» PROTO (sin la segunda frase del
  // prototipo); «ARCA no respondió a tiempo» y «Lo confirmamos solos
  // en unos minutos. No lo emitas de nuevo.» GUIA §1.2; «ARCA lo rechazó» PROTO; «Otro sistema usó este número en ARCA» y «El
  // punto de venta quedó bloqueado hasta resincronizar.» GUIA §1.2.
  "fiscal.pantalla.aviso_validando_titulo": {
    porDefecto: "Validando con ARCA…",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "avisoDe",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.aviso_validando_detalle": {
    porDefecto: "Todavía no tiene número.",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "avisoDe",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.aviso_incierto_titulo": {
    porDefecto: "ARCA no respondió a tiempo",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "avisoDe",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.aviso_incierto_detalle": {
    porDefecto: "Lo confirmamos solos en unos minutos. No lo emitas de nuevo.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "avisoDe",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.aviso_rechazado_titulo": {
    porDefecto: "ARCA lo rechazó",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "avisoDe",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.aviso_conflicto_titulo": {
    porDefecto: "Otro sistema usó este número en ARCA",
    largoMaximo: 120,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "avisoDe",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.aviso_conflicto_detalle": {
    porDefecto: "El punto de venta quedó bloqueado hasta resincronizar.",
    largoMaximo: 120,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "avisoDe",
      },
    ],
    fuente: "HEREDADO",
  },

  // ---------------------------------------------------------------------------------------------------------------------
  // Listado de comprobantes (6A celular + 6C escritorio, control de período A). CONTRATO: «6a+6c aprobado» (dueño, 2026-10-28).
  // ---------------------------------------------------------------------------------------------------------------------

  // Aprobado por el dueño el 2026-10-29 (respuesta en la sesión web del carril web): el encabezado «Comprobantes» (celular y escritorio), que es también el
  // rótulo de la barra inferior. (La guía §P3 la llama «Comprobantes emitidos»; el contrato, «Listado de comprobantes».)
  "fiscal.pantalla.listado_titulo": {
    porDefecto: "Comprobantes",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/facturacion/comprobantes/page.tsx",
        nombre: "PaginaDeListadoDeComprobantes",
      },
      { como: "FUNCION", archivo: "apps/web/ui/navegacion/menu.ts", nombre: "FILAS_DEL_MENU" },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/ayudas-de-pruebas.tsx",
        nombre: "enArmazon",
      },
    ],
    fuente: "HEREDADO",
  },

  // Rótulos de los filtros y de las columnas. CONTRATO-LISTADO, tabla de datos: «Período», «Estado», «Letra», «Punto de venta» (ya
  // está arriba: `rotulo_punto_de_venta`), «Búsqueda "Nombre o CUIT"» (el texto del campo de búsqueda), y la fila «Por fila: fecha,
  // comprobante (letra y número), cliente, documento, punto de venta, total, estado» (las columnas, con mayúscula inicial).
  "fiscal.pantalla.listado_rotulo_periodo": {
    porDefecto: "Período",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "armarLosFiltros",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_rotulo_estado": {
    porDefecto: "Estado",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/catalogo/filtros-de-productos.ts",
        nombre: "armarLosFiltros",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-puntos-de-venta.ts",
        nombre: "marcaDeActivo",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "armarLosFiltros",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "armarElListado",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_rotulo_letra": {
    porDefecto: "Letra",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "armarLosFiltros",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_rotulo_buscar": {
    porDefecto: "Nombre o CUIT",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "armarLosFiltros",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_rotulo_comprobante": {
    porDefecto: "Comprobante",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "armarElListado",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_rotulo_documento": {
    porDefecto: "Documento",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDelCliente",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "armarElListado",
      },
    ],
    fuente: "HEREDADO",
  },

  // Las opciones del período. CONTRATO-LISTADO: «Período (Hoy, Últimos 7 días, Este mes, Todo, Personalizado)». «Últimos 7 días»
  // incluye hoy (hoy y los 6 anteriores): D-54, confirmada por el dueño el 2026-10-29.
  "fiscal.pantalla.listado_periodo_hoy": {
    porDefecto: "Hoy",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "CLAVE_DE_PERIODO",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_periodo_ultimos_7_dias": {
    porDefecto: "Últimos 7 días",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "CLAVE_DE_PERIODO",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_periodo_este_mes": {
    porDefecto: "Este mes",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "CLAVE_DE_PERIODO",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_periodo_todo": {
    porDefecto: "Todo",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "CLAVE_DE_PERIODO",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_periodo_personalizado": {
    porDefecto: "Personalizado",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "CLAVE_DE_PERIODO",
      },
    ],
    fuente: "HEREDADO",
  },

  // Aprobado por el dueño el 2026-10-29 (respuesta en la sesión web del carril web): los rótulos de las dos fechas del período «Personalizado».
  // Fuente de la redacción: GUIA §4.6, `FECHAS_INVERTIDAS` («La fecha «desde» es posterior a «hasta».»).
  "fiscal.pantalla.listado_rotulo_desde": {
    porDefecto: "Desde",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "armarLosFiltros",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_rotulo_hasta": {
    porDefecto: "Hasta",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "armarLosFiltros",
      },
    ],
    fuente: "HEREDADO",
  },

  // «Sin filtrar» de las listas. CONTRATO-LISTADO: Estado «Todos», Punto de venta «Todos», Letra «Todas». El filtro de Estado
  // ofrece «Todos» y los siete estados de D-25 (D-52, confirmada por el dueño el 2026-10-29).
  "fiscal.pantalla.listado_todos": {
    porDefecto: "Todos",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "armarLosFiltros",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_todas": {
    porDefecto: "Todas",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "armarLosFiltros",
      },
    ],
    fuente: "HEREDADO",
  },
} as const;
