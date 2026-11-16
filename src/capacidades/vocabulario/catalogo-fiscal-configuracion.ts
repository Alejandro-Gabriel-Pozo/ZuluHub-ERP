/**
 * Los textos de Configuración fiscal (prefijo `fiscal.pantalla.config_*`): la lista de lo que falta y las pantallas de Puntos de
 * venta y de Datos fiscales (D-43). Viven aparte de `catalogo-fiscal-pantallas.ts` para que ninguno de los dos pase del tope de líneas; `catalogo.ts`
 * los incluye y `catalogo.test.ts` los revisa como a todos. Castellano neutro y en términos del negocio.
 *
 * Una línea de fuente por texto, con el cuestionario real y la pregunta (preguntas hechas al dueño con AskUserQuestion en la sesión
 * web del carril web, 2026-10-29):
 *   Q17 = cuestionario de las 17:45Z: P1 provincias, P2 textos de la lista, P3 textos de Puntos de venta, P4 textos de Datos fiscales
 *   (el dueño contestó «Aprobar tal cual» a la P4, que listaba, entre otros: los botones «Guardar borrador», «Confirmar» y «Cancelar»;
 *   los campos «CUIT», «Razón social», «Condición frente al IVA», «Domicilio», «Inicio de actividades» y los mismos de domicilio
 *   que en Puntos de venta). El rótulo «Domicilio» (no «Domicilio fiscal») es el de D-82 (dueño, 2026-11-03).
 *   QA  = cuestionario A (21:08Z): P1 entrada, P2 sin puntos de venta, P3 rótulos y aviso de pruebas, P4 sucursal cerrada.
 *   QB  = cuestionario B (21:11Z): P1 accesos, P2 el certificado solo informa, P3 certificado sin punto de venta, P4 «Guardando…».
 *   CONTRATO-CONFIG = `facturador-contratos-de-pantalla.md` (D-43 a D-49 y D-60 a D-68); PROTO-PV = prototipo de Puntos de venta,
 *   opción A. Un texto marcado SUPUESTO (DEC-0049) es del ingeniero: el dueño no lo aprobó tal cual. Previene: dar por aprobado en bloque lo
 *   que se preguntó de a uno (o no se preguntó).
 */
export const TEXTOS_DE_FISCAL_CONFIGURACION = {
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 2 (título y subtítulo); el título también es el renglón de Cuenta:
  // cuestionario B (21:11Z), pregunta 1.
  "fiscal.pantalla.config_titulo": {
    porDefecto: "Configuración fiscal",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/app/s/app/(operacion)/configuracion-fiscal/certificado-de-arca/[ambiente]/page.tsx",
        nombre: "MIGAS",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/configuracion-fiscal/certificado-de-arca/page.tsx",
        nombre: "PaginaDeCertificados",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/configuracion-fiscal/datos-fiscales/page.tsx",
        nombre: "PaginaDeDatosFiscales",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/configuracion-fiscal/page.tsx",
        nombre: "PaginaDeConfiguracionFiscal",
      },
      {
        como: "FUNCION",
        archivo:
          "apps/web/app/s/app/(operacion)/configuracion-fiscal/puntos-de-venta/[id]/page.tsx",
        nombre: "MIGAS",
      },
      {
        como: "FUNCION",
        archivo:
          "apps/web/app/s/app/(operacion)/configuracion-fiscal/puntos-de-venta/nuevo/page.tsx",
        nombre: "PaginaDeAltaDePuntoDeVenta",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/configuracion-fiscal/puntos-de-venta/page.tsx",
        nombre: "PaginaDePuntosDeVenta",
      },
      { como: "FUNCION", archivo: "apps/web/ui/navegacion/menu.ts", nombre: "FILAS_DEL_MENU" },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 2.
  "fiscal.pantalla.config_subtitulo": {
    porDefecto: "Lo que hace falta para emitir comprobantes",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/configuracion-fiscal/page.tsx",
        nombre: "PaginaDeConfiguracionFiscal",
      },
    ],
    fuente: "HEREDADO",
  },

  // Las tres filas de la lista. «Puntos de venta» es también el título de su pantalla.
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 2.
  "fiscal.pantalla.config_fila_datos_fiscales": {
    porDefecto: "Datos fiscales",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/configuracion-fiscal/datos-fiscales/page.tsx",
        nombre: "PaginaDeDatosFiscales",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta.ts",
        nombre: "armarLaLista",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 2.
  "fiscal.pantalla.config_puntos_de_venta": {
    porDefecto: "Puntos de venta",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/app/s/app/(operacion)/configuracion-fiscal/puntos-de-venta/[id]/page.tsx",
        nombre: "MIGAS",
      },
      {
        como: "FUNCION",
        archivo:
          "apps/web/app/s/app/(operacion)/configuracion-fiscal/puntos-de-venta/[id]/page.tsx",
        nombre: "PaginaDeUnPuntoDeVenta",
      },
      {
        como: "FUNCION",
        archivo:
          "apps/web/app/s/app/(operacion)/configuracion-fiscal/puntos-de-venta/nuevo/page.tsx",
        nombre: "PaginaDeAltaDePuntoDeVenta",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/configuracion-fiscal/puntos-de-venta/page.tsx",
        nombre: "PaginaDePuntosDeVenta",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta.ts",
        nombre: "armarLaLista",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 2. La fila es un enlace a la pantalla del certificado: dueño, 2026-11-03,
  // cuestionario «Certificado», opción B (asistente por ambiente).
  "fiscal.pantalla.config_fila_certificado": {
    porDefecto: "Certificado de ARCA",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/app/s/app/(operacion)/configuracion-fiscal/certificado-de-arca/[ambiente]/page.tsx",
        nombre: "MIGAS",
      },
      {
        como: "FUNCION",
        archivo:
          "apps/web/app/s/app/(operacion)/configuracion-fiscal/certificado-de-arca/[ambiente]/page.tsx",
        nombre: "PaginaDeUnCertificado",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/configuracion-fiscal/certificado-de-arca/page.tsx",
        nombre: "PaginaDeCertificados",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta.ts",
        nombre: "armarLaLista",
      },
    ],
    fuente: "HEREDADO",
  },

  // Los carteles de la lista (un tema completo no lleva cartel): CONTRATO-CONFIG D-46 y D-64, que el cuestionario de las 17:45Z,
  // pregunta 2, cita como «ya aprobados» y el dueño aprobó «tal cual».
  // CONTRATO-CONFIG D-46; cuestionario de las 17:45Z, pregunta 2.
  "fiscal.pantalla.config_cartel_falta_cargar": {
    porDefecto: "Falta cargar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta.ts",
        nombre: "CLAVE_DEL_CARTEL",
      },
    ],
    fuente: "HEREDADO",
  },
  // CONTRATO-CONFIG D-46; cuestionario de las 17:45Z, pregunta 2.
  "fiscal.pantalla.config_cartel_pendiente": {
    porDefecto: "Pendiente",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta.ts",
        nombre: "CLAVE_DEL_CARTEL",
      },
    ],
    fuente: "HEREDADO",
  },
  // CONTRATO-CONFIG D-46; cuestionario de las 17:45Z, pregunta 2.
  "fiscal.pantalla.config_cartel_falta_crear_uno": {
    porDefecto: "Falta crear uno",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta.ts",
        nombre: "CLAVE_DEL_CARTEL",
      },
    ],
    fuente: "HEREDADO",
  },
  // CONTRATO-CONFIG D-64; cuestionario de las 17:45Z, pregunta 2. Para el certificado: cuestionario B, pregunta 2.
  "fiscal.pantalla.config_cartel_vencido": {
    porDefecto: "Vencido",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta.ts",
        nombre: "CLAVE_DEL_CARTEL",
      },
    ],
    fuente: "HEREDADO",
  },
  // CONTRATO-CONFIG D-64; cuestionario de las 17:45Z, pregunta 2.
  "fiscal.pantalla.config_cartel_ninguno_activo": {
    porDefecto: "Ninguno activo",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta.ts",
        nombre: "CLAVE_DEL_CARTEL",
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

  // Dueño, 2026-11-03, D-82, Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md (botón único «Nuevo punto de venta», no «Agregar punto de venta»); también titula la pantalla del alta: título del alta confirmado por el dueño, 2026-11-04, D-96.
  "fiscal.pantalla.config_pv_agregar": {
    porDefecto: "Nuevo punto de venta",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/app/s/app/(operacion)/configuracion-fiscal/puntos-de-venta/nuevo/page.tsx",
        nombre: "PaginaDeAltaDePuntoDeVenta",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/configuracion-fiscal/puntos-de-venta/page.tsx",
        nombre: "PaginaDePuntosDeVenta",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, D-82, Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md (cuando no se pueden verificar los permisos, los botones de Puntos de venta salen apagados con este genérico).
  "fiscal.pantalla.config_pv_accion_no_permitida": {
    porDefecto: "Esta acción no está permitida.",
    usos: [{ como: "FUNCION", archivo: "apps/web/servidor/modulos.ts", nombre: "de" }],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_activo": {
    porDefecto: "Activo",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-puntos-de-venta.ts",
        nombre: "marcaDeActivo",
      },
    ],
    fuente: "HEREDADO",
  },
  // SUPUESTO (DEC-0049) del ingeniero: «No activo» suelto, derivado de «00003 · No activo» (`listado_punto_de_venta_no_activo`), que el dueño
  // aprobó el 2026-10-29 a las 14:23Z para el filtro del Listado (D-58 y D-60); en Puntos de venta no se le preguntó tal cual.
  // Revertirlo es cambiar este texto.
  "fiscal.pantalla.config_pv_no_activo": {
    porDefecto: "No activo",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-puntos-de-venta.ts",
        nombre: "marcaDeActivo",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_pruebas": {
    porDefecto: "Pruebas",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-certificado.ts",
        nombre: "nombreDelAmbiente",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-puntos-de-venta.ts",
        nombre: "marcaDeAmbiente",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "etiquetaDelPunto",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_produccion": {
    porDefecto: "Producción",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-certificado.ts",
        nombre: "nombreDelAmbiente",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-puntos-de-venta.ts",
        nombre: "marcaDeAmbiente",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3 (el botón y la ventana); D-48. El aviso de la ventana es el texto que
  // ya existe, `error.fiscal_ambiente_no_vuelve`.
  "fiscal.pantalla.config_pv_pasar_a_produccion": {
    porDefecto: "Pasar a producción",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/DetalleDelPuntoDeVenta.cliente.tsx",
        nombre: "DetalleDelPuntoDeVenta",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3 («¿Pasar a producción?»).
  "fiscal.pantalla.config_pv_ventana_titulo": {
    porDefecto: "¿Pasar a producción?",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/DetalleDelPuntoDeVenta.cliente.tsx",
        nombre: "DetalleDelPuntoDeVenta",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_activar": {
    porDefecto: "Activar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/DetalleDelPuntoDeVenta.cliente.tsx",
        nombre: "DetalleDelPuntoDeVenta",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_desactivar": {
    porDefecto: "Desactivar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/DetalleDelPuntoDeVenta.cliente.tsx",
        nombre: "DetalleDelPuntoDeVenta",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_editar": {
    porDefecto: "Editar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/DetalleDelPuntoDeVenta.cliente.tsx",
        nombre: "DetalleDelPuntoDeVenta",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_guardar": {
    porDefecto: "Guardar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/FormularioDePuntoDeVenta.cliente.tsx",
        nombre: "FormularioDePuntoDeVenta",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/sesion/PantallaDeContactoDeLaSucursal.cliente.tsx",
        nombre: "PantallaDeContactoDeLaSucursal",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_cancelar": {
    porDefecto: "Cancelar",
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
        nombre: "FormularioDeDatosFiscales",
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
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_campo_numero": {
    porDefecto: "Número de punto de venta",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/FormularioDePuntoDeVenta.cliente.tsx",
        nombre: "FormularioDePuntoDeVenta",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_domicilio": {
    porDefecto: "Domicilio del punto de venta",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/FormularioDePuntoDeVenta.cliente.tsx",
        nombre: "FormularioDePuntoDeVenta",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "armarLaHoja",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_calle": {
    porDefecto: "Calle",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx",
        nombre: "FormularioDeDatosFiscales",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/FormularioDePuntoDeVenta.cliente.tsx",
        nombre: "FormularioDePuntoDeVenta",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3 («Número»).
  "fiscal.pantalla.config_pv_numero_de_calle": {
    porDefecto: "Número",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx",
        nombre: "FormularioDeDatosFiscales",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/FormularioDePuntoDeVenta.cliente.tsx",
        nombre: "FormularioDePuntoDeVenta",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_piso": {
    porDefecto: "Piso",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx",
        nombre: "FormularioDeDatosFiscales",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/FormularioDePuntoDeVenta.cliente.tsx",
        nombre: "FormularioDePuntoDeVenta",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_departamento": {
    porDefecto: "Departamento",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx",
        nombre: "FormularioDeDatosFiscales",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/FormularioDePuntoDeVenta.cliente.tsx",
        nombre: "FormularioDePuntoDeVenta",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_localidad": {
    porDefecto: "Localidad",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx",
        nombre: "FormularioDeDatosFiscales",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/FormularioDePuntoDeVenta.cliente.tsx",
        nombre: "FormularioDePuntoDeVenta",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3. También nombra la opción vacía del selector (accesibilidad, sin texto
  // nuevo).
  "fiscal.pantalla.config_pv_provincia": {
    porDefecto: "Provincia",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx",
        nombre: "FormularioDeDatosFiscales",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/FormularioDePuntoDeVenta.cliente.tsx",
        nombre: "FormularioDePuntoDeVenta",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_codigo_postal": {
    porDefecto: "Código postal",
    usos: [
      {
        como: "FUNCION",
        archivo:
          "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx",
        nombre: "FormularioDeDatosFiscales",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/FormularioDePuntoDeVenta.cliente.tsx",
        nombre: "FormularioDePuntoDeVenta",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_ayuda": {
    porDefecto: "Tocá un punto de venta para editarlo, activarlo o desactivarlo.",
    largoMaximo: 120,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/configuracion-fiscal/puntos-de-venta/page.tsx",
        nombre: "PaginaDePuntosDeVenta",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-10-29, cuestionario A (21:08Z), pregunta 2.
  "fiscal.pantalla.config_pv_vacio": {
    porDefecto: "Todavía no hay puntos de venta.",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/configuracion-fiscal/puntos-de-venta/page.tsx",
        nombre: "PaginaDePuntosDeVenta",
      },
    ],
    fuente: "HEREDADO",
  },
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
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Organización».
  "fiscal.pantalla.config_cert_organizacion": {
    porDefecto: "Organización",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/PasoGenerarPedido.cliente.tsx",
        nombre: "PasoGenerarPedido",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Titular» (el dato, no el campo).
  "fiscal.pantalla.config_cert_titular": {
    porDefecto: "Titular",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-certificado.ts",
        nombre: "dato",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Vence» (la fecha va aparte, dd/mm/aaaa).
  "fiscal.pantalla.config_cert_vence": {
    porDefecto: "Vence",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-certificado.ts",
        nombre: "dato",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-certificado.ts",
        nombre: "textoDeVence",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Pedido» (título del paso 2).
  "fiscal.pantalla.config_cert_pedido": {
    porDefecto: "Pedido",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/AsistenteDeCertificado.cliente.tsx",
        nombre: "CLAVE_DEL_TITULO",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Copiar».
  "fiscal.pantalla.config_cert_copiar": {
    porDefecto: "Copiar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/PasoDelPedido.cliente.tsx",
        nombre: "PasoDelPedido",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Descargar».
  "fiscal.pantalla.config_cert_descargar": {
    porDefecto: "Descargar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/PasoDelPedido.cliente.tsx",
        nombre: "PasoDelPedido",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Certificado» (título del paso 3 y rótulo del campo de pegado).
  "fiscal.pantalla.config_cert_certificado": {
    porDefecto: "Certificado",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/AsistenteDeCertificado.cliente.tsx",
        nombre: "CLAVE_DEL_TITULO",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Cargar certificado».
  "fiscal.pantalla.config_cert_cargar": {
    porDefecto: "Cargar certificado",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/AsistenteDeCertificado.cliente.tsx",
        nombre: "AsistenteDeCertificado",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/PasoCargarCertificado.cliente.tsx",
        nombre: "PasoCargarCertificado",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Reemplazar».
  "fiscal.pantalla.config_cert_reemplazar": {
    porDefecto: "Reemplazar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/AsistenteDeCertificado.cliente.tsx",
        nombre: "AsistenteDeCertificado",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Siguiente».
  "fiscal.pantalla.config_cert_siguiente": {
    porDefecto: "Siguiente",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/PasoDelPedido.cliente.tsx",
        nombre: "PasoDelPedido",
      },
    ],
    fuente: "HEREDADO",
  },
} as const;
