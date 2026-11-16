/** Parte 2 de 3 de `TEXTOS_DE_FISCAL` (`catalogo-fiscal.ts`, que la reexporta): se partió para no pasar del tope de líneas. Ninguna clave ni texto cambió. */
export const TEXTOS_DE_FISCAL_2 = {
  "error.fiscal_comprobante_ya_enviado": {
    porDefecto: "El comprobante ya se envió a ARCA: esperá su respuesta antes de descartarlo.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  "error.fiscal_estado_no_descartable": {
    porDefecto: "Este comprobante ya no se puede descartar.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  // Voseo aprobado por el dueño, 2026-11-04, D-113 (Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md):
  // antes «Los datos cambiaron mientras los miraba. Actualizá la pantalla e intentá de nuevo.».
  "error.fiscal_version_desactualizada": {
    porDefecto:
      "Los datos cambiaron mientras los mirabas. Actualizá la pantalla e intentá de nuevo.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  "error.fiscal_serie_bloqueada": {
    porDefecto:
      "La numeración del punto de venta está bloqueada hasta que se resincronice con ARCA.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  "error.fiscal_estado_no_reintentable": {
    porDefecto: "Este comprobante no se puede reintentar en su estado actual.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  "error.fiscal_serie_no_encontrada": {
    porDefecto: "No se encontró la numeración de este punto de venta.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  "error.fiscal_serie_no_bloqueada": {
    porDefecto: "La numeración ya no está bloqueada: no hace falta resincronizar.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  "error.fiscal_ultimo_distinto_del_de_arca": {
    porDefecto:
      "ARCA informa otro último número que el que viste. Revisá el dato y confirmá de nuevo.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  "error.fiscal_desfase_hacia_atras": {
    porDefecto:
      "ARCA informa un número menor que el registrado y no se puede corregir desde acá. Consultá a soporte.",
    largoMaximo: 200,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  "error.fiscal_arca_no_disponible": {
    porDefecto: "ARCA no está disponible en este momento. Intentá de nuevo en unos minutos.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  "error.fiscal_arca_certificado_no_sirve": {
    porDefecto:
      "El certificado de ARCA de este punto de venta no se pudo usar. Revíselo o cárguelo de nuevo.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  "error.fiscal_arca_servicio_no_autorizado": {
    porDefecto:
      "El certificado no está autorizado en ARCA para facturar. Autorícelo en el Administrador de Relaciones de ARCA.",
    largoMaximo: 200,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  "error.fiscal_arca_acceso_en_curso": {
    porDefecto:
      "ARCA ya tiene un acceso abierto para este certificado. Esperá unos minutos e intentá de nuevo.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  "error.fiscal_serie_en_curso": {
    porDefecto:
      "Hay un comprobante en proceso en este punto de venta. Esperá a que termine para cambiar el ambiente.",
    largoMaximo: 200,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  "error.fiscal_ambiente_no_vuelve": {
    porDefecto: "Un punto de venta que pasó a producción no vuelve al ambiente de pruebas.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/DetalleDelPuntoDeVenta.cliente.tsx",
        nombre: "DetalleDelPuntoDeVenta",
      },
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  // Pasar un punto de venta a producción que ARCA no tiene habilitado (D-77). Fuente del texto: el MISMO, palabra por palabra, que el dueño
  // aprobó para el rechazo 10005 de una factura, `fiscal.arca.punto_de_venta_no_habilitado` (este archivo, más abajo). D-77 pide un aviso
  // cuyo texto no estaba aprobado: se reutiliza el existente (decisión del ingeniero, a confirmar por el dueño).
  "error.fiscal_punto_de_venta_no_habilitado_en_arca": {
    porDefecto: "El punto de venta no está habilitado en ARCA para facturar con web service.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  "error.fiscal_ya_emitio_en_produccion": {
    porDefecto: "Este punto de venta ya emitió en producción: no se puede cambiar de ambiente.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  "error.fiscal_filtro_invalido": {
    porDefecto: "Los filtros del listado no son válidos.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  // Fuente: `Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md`, D-36 («el servidor responde "sucursal no elegida"
  // y se pide elegir»; confirmada por el dueño el 2026-10-28) y D-34 (el servidor valida la sucursal elegida cada vez; el error
  // de una que no es de su alcance es `SUCURSAL_FUERA_DE_ALCANCE`, de `capacidades/permisos/alcance.ts`). Los TEXTOS son solo la
  // lectura literal de esos dos nombres: la pantalla se guía por el CÓDIGO (abre el selector). Texto de «no eligió sucursal»:
  // «Elegí una sucursal.» (dueño, 2026-10-29, respuesta en la sesión web del carril web); el de fuera de alcance sigue provisorio.
  "error.fiscal_sucursal_no_elegida": {
    porDefecto: "Elegí una sucursal.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/FormularioDePuntoDeVenta.cliente.tsx",
        nombre: "FormularioDePuntoDeVenta",
      },
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  "error.fiscal_sucursal_fuera_de_alcance": {
    porDefecto: "Sucursal fuera de tu alcance.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  // Fuente: `Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md`, D-50 («Una sucursal cerrada no emite»; confirmada
  // por el dueño el 2026-10-29: «No, una sucursal cerrada no emite»). El TEXTO es solo la lectura literal del nombre de la decisión: la
  // pantalla se guía por el CÓDIGO. Para emitir sigue siendo el texto provisorio de D-50; para crear, mudar y activar un punto de
  // venta en una sucursal cerrada, D-78, D-79 y D-80 (el dueño, 2026-10-29) confirmaron que «Sucursal cerrada.» sirve.
  "error.fiscal_sucursal_cerrada": {
    porDefecto: "Sucursal cerrada.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-puntos-de-venta.ts",
        nombre: "accionesDelPuntoDeVenta",
      },
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
} as const;
