/** Parte 5 de 7 de `TEXTOS_DE_FISCAL_PANTALLAS` (`catalogo-fiscal-pantallas.ts`, que la reexporta): se partió para no pasar del tope de líneas. Ninguna clave ni texto cambió. */
export const TEXTOS_DE_FISCAL_PANTALLAS_5 = {
  // CONTRATO-LISTADO, «Acciones»: «"Filtros (n)" y "Limpiar"».
  "fiscal.pantalla.listado_filtros": {
    porDefecto: "Filtros ({cantidad})",
    marcadores: ["cantidad"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "armarLosFiltros",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_limpiar": {
    porDefecto: "Limpiar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "armarLosFiltros",
      },
    ],
    fuente: "HEREDADO",
  },

  // CONTRATO: paginación «Página siguiente».
  "fiscal.pantalla.listado_pagina_siguiente": {
    porDefecto: "Página siguiente",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/catalogo/modelo-de-productos.ts",
        nombre: "armarLaLista",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/catalogo/modelo-de-secciones.ts",
        nombre: "armarUnaSeccion",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-pendientes.ts",
        nombre: "armarLosPendientes",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "armarElListado",
      },
    ],
    fuente: "HEREDADO",
  },

  // Filtro inválido en el listado. Fuente: guía `06-facturador-pantallas-y-mensajes.md` §4.6 (Consultas): `FECHAS_INVERTIDAS` «La fecha
  // «desde» es posterior a «hasta».» y `TEXTO_DEMASIADO_LARGO` «Buscá con menos letras.».
  "fiscal.pantalla.listado_error_fechas_invertidas": {
    porDefecto: "La fecha «desde» es posterior a «hasta».",
    largoMaximo: 120,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "errorParaElListado",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_error_texto_demasiado_largo": {
    porDefecto: "Buscá con menos letras.",
    largoMaximo: 120,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "errorParaElListado",
      },
    ],
    fuente: "HEREDADO",
  },

  // CONTRATO-LISTADO, «Estados»: vacío «No hay comprobantes con esos filtros. Probá con otro período o tocá «Limpiar».»; error «No pudimos cargar la lista. Probá de nuevo.» más la referencia PD-… (la referencia es `error.referencia`).
  "fiscal.pantalla.listado_vacio": {
    porDefecto: "No hay comprobantes con esos filtros. Probá con otro período o tocá «Limpiar».",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "armarElListado",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_error": {
    porDefecto: "No pudimos cargar la lista. Probá de nuevo.",
    largoMaximo: 120,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "errorParaElListado",
      },
    ],
    fuente: "HEREDADO",
  },

  // Aprobado por el dueño el 2026-10-29 (respuesta en la sesión web del carril web): el documento de un consumidor final sin identificar se ve «—».
  "fiscal.pantalla.listado_sin_documento": {
    porDefecto: "—",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "filaDe",
      },
    ],
    fuente: "HEREDADO",
  },

  // Aprobado por el dueño el 2026-10-29 (respuesta en la sesión web del carril web): el rótulo del selector de sucursal, la
  // invitación a elegir cuando todavía no eligió (D-36), el botón de esa elección «Ver comprobantes» (el del prototipo, «Ver {{cantidad}}
  // comprobantes», lleva la cantidad, que no va: D-32) y la marca de una sucursal cerrada (D-37; MENSAJE-DUEÑO, 2026-10-28:
  // «Sí, aparece marcada como cerrada»).
  "fiscal.pantalla.listado_rotulo_sucursal": {
    porDefecto: "Sucursal",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/FormularioDePuntoDeVenta.cliente.tsx",
        nombre: "FormularioDePuntoDeVenta",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "armarLaEleccionDeSucursal",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_elegir_sucursal": {
    porDefecto: "Elegí una sucursal para ver sus comprobantes.",
    largoMaximo: 120,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "armarLaEleccionDeSucursal",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_ver_comprobantes": {
    porDefecto: "Ver comprobantes",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "armarLaEleccionDeSucursal",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_sucursal_cerrada": {
    porDefecto: "{nombre} · Cerrada",
    marcadores: ["nombre"],
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/app/s/app/(operacion)/configuracion-fiscal/puntos-de-venta/[id]/page.tsx",
        nombre: "PaginaDeUnPuntoDeVenta",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-puntos-de-venta.ts",
        nombre: "sucursalParaMostrar",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "armarLaEleccionDeSucursal",
      },
    ],
    fuente: "HEREDADO",
  },
  // Aprobado por el dueño el 2026-10-29 (respuesta a un cuestionario en la sesión web del carril web; D-58 y D-60): en el filtro
  // «Punto de venta», el que no está activo (dado de baja o nuevo sin uso) se ve «00003 · No activo»; el activo, solo «00003».
  "fiscal.pantalla.listado_punto_de_venta_no_activo": {
    porDefecto: "{numero} · No activo",
    marcadores: ["numero"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "armarLosFiltros",
      },
    ],
    fuente: "HEREDADO",
  },

  // RESPUESTA-DUEÑO-2026-10-29: el botón que aplica los filtros se llama «Aplicar filtros» (y «Ver comprobantes» queda solo para
  // la elección de sucursal), y la fecha que no existe en el calendario (por ejemplo 31 de febrero) se dice por campo.
  "fiscal.pantalla.listado_aplicar": {
    porDefecto: "Aplicar filtros",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/catalogo/filtros-de-productos.ts",
        nombre: "armarLosFiltros",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "armarLosFiltros",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_error_fecha_desde_no_existe": {
    porDefecto: "La fecha «desde» no existe.",
    largoMaximo: 120,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "errorParaElListado",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.listado_error_fecha_hasta_no_existe": {
    porDefecto: "La fecha «hasta» no existe.",
    largoMaximo: 120,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "errorParaElListado",
      },
    ],
    fuente: "HEREDADO",
  },

  // Anular un comprobante por importe (opción 12A, aprobada por el dueño el 2026-10-29). Fuentes de los textos que siguen:
  // DUEÑO-ANULAR = «dueño, 2026-10-29, respuestas a cuestionarios de opciones en la sesión web del carril web» (los textos tal
  // cual figuran en el prototipo `Main.dc.html`, pantallas A y su variante letra C de `OpcionB.dc.html`); CONTRATO = D-69 a D-74 y
  // D-29 de `facturador-contratos-de-pantalla.md`. «Ya anulado con notas de crédito», «Sin notas», «IVA {alicuota} %» (el nombre de
  // cada fila) y el texto de cada nota de la lista ya existen arriba (`ya_anulado`, `sin_notas`, `renglon_iva`, `nombreDe`): una
  // regla, un lugar.
  // ---------------------------------------------------------------------------------------------------------------------

  // DUEÑO-ANULAR: el título de la pantalla; debajo, «Factura B 00001-00000123 · Juan Pérez» (el comprobante y el cliente).
  "fiscal.pantalla.anular_titulo": {
    porDefecto: "Anular comprobante",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/facturacion/comprobantes/[id]/anular/page.tsx",
        nombre: "OPCIONES",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/pruebas/ayudas-de-anulacion.tsx",
        nombre: "enArmazon",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_subtitulo": {
    porDefecto: "{comprobante} · {cliente}",
    marcadores: ["cliente", "comprobante"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
    ],
    fuente: "HEREDADO",
  },
} as const;
