/** Parte 1 de 3 de `TEXTOS_DE_FISCAL` (`catalogo-fiscal.ts`, que la reexporta): se partió para no pasar del tope de líneas. Ninguna clave ni texto cambió. */
export const TEXTOS_DE_FISCAL_1 = {
  "error.fiscal_datos_invalidos": {
    porDefecto:
      "Revisá los datos del comprobante: hay campos incompletos o con un formato que no es válido.",
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
  "error.fiscal_pedido_sin_identificar": {
    porDefecto: "No se pudo identificar el pedido. Actualizá la pantalla e intentá de nuevo.",
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
  "error.fiscal_pedido_repetido": {
    porDefecto:
      "Ya existe un comprobante con esta misma referencia pero con otros datos. Cárguelo de nuevo desde el principio.",
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
  "error.fiscal_punto_de_venta_no_encontrado": {
    porDefecto: "No se encontró el punto de venta.",
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
  "error.fiscal_punto_de_venta_inactivo": {
    porDefecto: "El punto de venta está inactivo. Actívelo antes de emitir.",
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
  "error.fiscal_emisor_inactivo": {
    porDefecto: "El emisor de este punto de venta está inactivo.",
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
  "error.fiscal_sin_datos_fiscales": {
    porDefecto: "Faltan los datos fiscales confirmados de la empresa.",
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
  "error.fiscal_sin_certificado": {
    porDefecto: "No hay un certificado de ARCA vigente para este punto de venta y ambiente.",
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
  "error.fiscal_comprobante_no_encontrado": {
    porDefecto: "No encontramos ese comprobante.",
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
  "error.fiscal_asociado_no_autorizado": {
    porDefecto: "Solo se puede corregir un comprobante que ARCA ya autorizó.",
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
  "error.fiscal_asociado_de_otro_emisor": {
    porDefecto: "La nota debe ser del mismo emisor que el comprobante que corrige.",
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
  "error.fiscal_asociado_de_otro_ambiente": {
    porDefecto:
      "La nota debe emitirse en el mismo ambiente (pruebas o producción) que el comprobante que corrige.",
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
  "error.fiscal_asociado_no_asociable": {
    porDefecto: "No se puede emitir una nota sobre una nota de crédito.",
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
  "error.fiscal_motivo_invalido": {
    porDefecto: "Escribí el motivo: es obligatorio y tiene un largo máximo.",
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
  "error.fiscal_receptor_invalido": {
    // Genérico y sin nombrar campos (dueño, 2026-11-06, conversación directa con la sesión «Emitir»: «uno genérico, en voseo»; Q22).
    // Aprobado por el dueño el 12/11/2026 («apruebo la 1 y 2»: este texto y la unificación al voseo), Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md.
    // Genérico a propósito. Previene un aviso que nombra un campo que Emitir no tiene.
    porDefecto: "Revisá los datos del cliente.",
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
  "error.fiscal_receptor_invalido_para_a": {
    porDefecto: "Una factura A necesita el CUIT del cliente.",
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
  "error.fiscal_receptor_igual_al_emisor": {
    porDefecto: "El documento del cliente no puede ser el mismo que el de la empresa que factura.",
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
  "error.fiscal_receptor_no_categorizado": {
    porDefecto: "Todavía no se pueden emitir comprobantes a un sujeto no categorizado.",
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
  "error.fiscal_sin_renglones": {
    porDefecto: "Agregá al menos un renglón al comprobante.",
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
  "error.fiscal_demasiados_renglones": {
    porDefecto: "El comprobante tiene más renglones de los permitidos.",
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
  "error.fiscal_renglon_invalido": {
    porDefecto: "Hay un renglón con la descripción o la cantidad incompletas.",
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
  "error.fiscal_alicuota_en_letra_c": {
    porDefecto: "Los comprobantes C no llevan alícuota de IVA en los renglones.",
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
  "error.fiscal_falta_alicuota": {
    porDefecto: "Falta la alícuota de IVA en un renglón.",
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
  "error.fiscal_modo_de_precio_invalido_para_c": {
    porDefecto: "Los comprobantes C se cargan con el IVA incluido en el precio.",
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
  "error.fiscal_fechas_de_servicio_invalidas": {
    porDefecto:
      "Revisá las fechas del servicio: son obligatorias para servicios y el período tiene que tener sentido.",
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
  "error.fiscal_total_fuera_de_rango": {
    porDefecto: "El total del comprobante es demasiado grande o no es válido.",
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
} as const;
