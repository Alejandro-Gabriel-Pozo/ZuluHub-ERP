/** Parte 3 de 4 de `TEXTOS_DE_FISCAL_CONFIGURACION` (`catalogo-fiscal-configuracion.ts`, que la reexporta): se partió para no pasar del tope de líneas. Ninguna clave ni texto cambió. */
export const TEXTOS_DE_FISCAL_CONFIGURACION_3 = {
  // Dueño, 2026-10-29, cuestionario A (21:08Z), pregunta 3 («Ambiente»). El rótulo «Estado» de la misma pregunta es
  // `listado_rotulo_estado` (mismo texto: una regla, un lugar).
  "fiscal.pantalla.config_pv_rotulo_ambiente": {
    porDefecto: "Ambiente",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-puntos-de-venta.ts",
        nombre: "marcaDeAmbiente",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario A (21:08Z), pregunta 3 (el aviso de pruebas).
  "fiscal.pantalla.config_pv_aviso_pruebas": {
    porDefecto: "Las facturas de pruebas no tienen valor fiscal.",
    largoMaximo: 120,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-puntos-de-venta.ts",
        nombre: "avisoDePruebas",
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
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario B (21:11Z), pregunta 4 («Guardando…» en alta, edición y cambio de ambiente).
  // SUPUESTO (DEC-0049) del ingeniero: el mismo texto también en Activar y Desactivar; el dueño lo aprobó para alta, edición y cambio de
  // ambiente, no para estas dos acciones. Revertirlo es quitar `textoEnviando` de ese botón en `DetalleDelPuntoDeVenta.cliente.tsx`.
  // Datos fiscales reutiliza esta misma clave para «Guardar borrador» y «Confirmar» (sin clave nueva). SUPUESTO (DEC-0049) del ingeniero: el dueño
  // aprobó «Guardando…» para Puntos de venta, no se le preguntó tal cual para Datos fiscales. Revertirlo es quitar `textoEnviando` de ambos
  // botones en `FormularioDeDatosFiscales.cliente.tsx`.
  "fiscal.pantalla.config_pv_guardando": {
    porDefecto: "Guardando…",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/DetalleDelPuntoDeVenta.cliente.tsx",
        nombre: "DetalleDelPuntoDeVenta",
      },
      {
        como: "FUNCION",
        archivo:
          "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx",
        nombre: "esperando",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/FormularioDePuntoDeVenta.cliente.tsx",
        nombre: "FormularioDePuntoDeVenta",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/PasoCargarCertificado.cliente.tsx",
        nombre: "PasoCargarCertificado",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/PasoGenerarPedido.cliente.tsx",
        nombre: "PasoGenerarPedido",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/sesion/PantallaDeContactoDeLaSucursal.cliente.tsx",
        nombre: "PantallaDeContactoDeLaSucursal",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario B (21:11Z), pregunta 1: el pendiente de Inicio que lleva a la lista de Configuración fiscal.
  "fiscal.pantalla.config_pendiente_inicio": {
    porDefecto: "Completá la configuración fiscal.",
    largoMaximo: 120,
    usos: [
      { como: "FUNCION", archivo: "apps/web/servidor/modulos.ts", nombre: "pendientesDeLaEmpresa" },
    ],
    fuente: "HEREDADO",
  },
  // PROTO-PV, pantalla 3 («Punto de venta 00002»): el título de un punto de venta. Lo muestra el prototipo; ningún cuestionario lo
  // nombra.
  "fiscal.pantalla.config_pv_titulo_con_numero": {
    porDefecto: "Punto de venta {numero}",
    marcadores: ["numero"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-puntos-de-venta.ts",
        nombre: "tituloDelPuntoDeVenta",
      },
    ],
    fuente: "HEREDADO",
  },
  // Datos fiscales (Q17 de 2026-10-29; D-82 y D-88 del 2026-11-03 sacaron la lectura intermedia, «Corregir», «Seguir con el borrador», el aviso
  // del borrador y «Rige desde…»). Los textos de la condición frente al IVA son los de D-44, en `opciones-de-datos-fiscales.ts`.
  // «Datos fiscales», el título del formulario, es `config_fila_datos_fiscales` (D-88: la fila de la lista abre directo el formulario).
  // Dueño, 2026-10-29, Q17 pregunta 4.
  "fiscal.pantalla.config_df_guardar_borrador": {
    porDefecto: "Guardar borrador",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx",
        nombre: "FormularioDeDatosFiscales",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, Q17 pregunta 4 (un solo botón que rige desde ya: D-61). La clave no dice «confirmar»: el catálogo rechaza como
  // secreto todo nombre que contenga «firma» (`NOMBRE_DE_SECRETO`).
  "fiscal.pantalla.config_df_que_rija": {
    porDefecto: "Confirmar",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx",
        nombre: "FormularioDeDatosFiscales",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, Q17 pregunta 4.
  "fiscal.pantalla.config_df_cuit": {
    porDefecto: "CUIT",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-datos-fiscales.ts",
        nombre: "filaDelCuit",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, Q17 pregunta 4.
  "fiscal.pantalla.config_df_razon_social": {
    porDefecto: "Razón social",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx",
        nombre: "FormularioDeDatosFiscales",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "armarLaHoja",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, Q17 pregunta 4. También nombra la opción vacía del selector (como «Provincia»), sin texto nuevo.
  "fiscal.pantalla.config_df_condicion_iva": {
    porDefecto: "Condición frente al IVA",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx",
        nombre: "FormularioDeDatosFiscales",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "armarLaHoja",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "receptorDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDelCliente",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, D-82 (rótulos aprobados).
  "fiscal.pantalla.config_df_domicilio_fiscal": {
    porDefecto: "Domicilio",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx",
        nombre: "FormularioDeDatosFiscales",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "armarLaHoja",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "receptorDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDelCliente",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, Q17 pregunta 4.
  "fiscal.pantalla.config_df_inicio_actividades": {
    porDefecto: "Inicio de actividades",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx",
        nombre: "FormularioDeDatosFiscales",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "armarLaHoja",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-05: opción B del prototipo de Ingresos Brutos en Datos fiscales (https://claude.ai/artifact/75NVoKCZYz4GXvCMnoRG6y); texto de la norma: RG 1415, Anexo II, A.I.a punto 4 (Pedernal-docs/12-referencias-externas/arca-normas-de-comprobantes/rg1415_dcp.html), D-116.
  // La etiqueta del desplegable es «Ingresos Brutos», que ya existe como `imprimir_ingresos_brutos` (una regla, un lugar).
  "fiscal.pantalla.config_df_iibb_numero": {
    porDefecto: "Número de inscripción",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx",
        nombre: "FormularioDeDatosFiscales",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-05: opción B del prototipo de Ingresos Brutos en Datos fiscales (https://claude.ai/artifact/75NVoKCZYz4GXvCMnoRG6y); texto de la norma: RG 1415, Anexo II, A.I.a punto 4 (Pedernal-docs/12-referencias-externas/arca-normas-de-comprobantes/rg1415_dcp.html), D-116.
  "fiscal.pantalla.config_df_iibb_no_contribuyente": {
    porDefecto: "No contribuyente",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx",
        nombre: "FormularioDeDatosFiscales",
      },
    ],
    fuente: "HEREDADO",
  },
  // Certificado de ARCA (opción B, asistente de 3 pasos por ambiente): los 13 textos nuevos los aprobó el dueño el 2026-11-03 en el
  // cuestionario «Certificado»; «Guardando…» del certificado reutiliza `config_pv_guardando` (mismo cuestionario). Las claves no dicen
  // «clave» ni «firma»: el catálogo rechaza como secreto todo nombre que las contenga (`NOMBRE_DE_SECRETO`).
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Generar pedido» (botón y título del paso 1).
  "fiscal.pantalla.config_cert_generar_pedido": {
    porDefecto: "Generar pedido",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/AsistenteDeCertificado.cliente.tsx",
        nombre: "AsistenteDeCertificado",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/AsistenteDeCertificado.cliente.tsx",
        nombre: "CLAVE_DEL_TITULO",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/PasoGenerarPedido.cliente.tsx",
        nombre: "PasoGenerarPedido",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Alias».
  "fiscal.pantalla.config_cert_alias": {
    porDefecto: "Alias",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/PasoGenerarPedido.cliente.tsx",
        nombre: "PasoGenerarPedido",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-certificado.ts",
        nombre: "dato",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «CUIT del titular».
  "fiscal.pantalla.config_cert_cuit_titular": {
    porDefecto: "CUIT del titular",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/PasoGenerarPedido.cliente.tsx",
        nombre: "PasoGenerarPedido",
      },
    ],
    fuente: "HEREDADO",
  },
} as const;
