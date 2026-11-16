/** Parte 1 de 4 de `TEXTOS_DE_FISCAL_CONFIGURACION` (`catalogo-fiscal-configuracion.ts`, que la reexporta): se partió para no pasar del tope de líneas. Ninguna clave ni texto cambió. */
export const TEXTOS_DE_FISCAL_CONFIGURACION_1 = {
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
} as const;
