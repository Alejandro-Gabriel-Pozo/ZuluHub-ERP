/** Parte 3 de 3 de `TEXTOS_DE_FISCAL` (`catalogo-fiscal.ts`, que la reexporta): se partió para no pasar del tope de líneas. Ninguna clave ni texto cambió. */
export const TEXTOS_DE_FISCAL_3 = {
  // Fuente de los cuatro textos que siguen: `Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md`, registro de decisiones,
  // D-66 (los tres mensajes al cargar un punto de venta) y D-67 («Revisá los datos marcados.», que reemplaza en Datos fiscales y Puntos
  // de venta al «Revisá los datos del comprobante», que es de las facturas); ambas confirmadas por el dueño el 2026-10-29, que aprobó
  // los textos tal cual (en voseo, como los aprobó).
  "error.fiscal_configuracion_datos_invalidos": {
    porDefecto: "Revisá los datos marcados.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDelCliente",
      },
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-fiscal.ts",
        nombre: "CLAVES_DE_ERRORES_FISCALES",
      },
    ],
    fuente: "HEREDADO",
  },
  "error.fiscal_punto_de_venta_duplicado": {
    porDefecto: "Ya existe un punto de venta con ese número.",
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
  "error.fiscal_punto_de_venta_numero_inmutable": {
    porDefecto: "Este punto de venta ya emitió comprobantes: el número no se puede cambiar.",
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
  "error.fiscal_punto_de_venta_sin_domicilio": {
    porDefecto: "Para activarlo, cargá un domicilio.",
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
  "fiscal.arca.error_generico": {
    porDefecto: "ARCA no aceptó el comprobante. Código {codigo}.",
    largoMaximo: 160,
    marcadores: ["codigo"],
    usos: [
      {
        como: "FUNCION",
        archivo: "src/composicion/errores-fiscales.ts",
        nombre: "GENERICO_POR_CLASE",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.arca.observacion_generica": {
    porDefecto: "ARCA agregó una observación al comprobante. Código {codigo}.",
    largoMaximo: 160,
    marcadores: ["codigo"],
    usos: [
      {
        como: "FUNCION",
        archivo: "src/composicion/errores-fiscales.ts",
        nombre: "GENERICO_POR_CLASE",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.arca.evento_generico": {
    porDefecto: "ARCA informó un evento sobre el comprobante. Código {codigo}.",
    largoMaximo: 160,
    marcadores: ["codigo"],
    usos: [
      {
        como: "FUNCION",
        archivo: "src/composicion/errores-fiscales.ts",
        nombre: "GENERICO_POR_CLASE",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.arca.autorizacion": {
    porDefecto:
      "ARCA no reconoció la autorización del certificado. Revisá que esté autorizado para facturar.",
    largoMaximo: 200,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/composicion/errores-fiscales.ts",
        nombre: "CLAVE_DE_CATEGORIA",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.arca.problema_interno": {
    porDefecto:
      "ARCA tuvo un problema interno. El comprobante se confirma solo: no lo emita de nuevo.",
    largoMaximo: 200,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/composicion/errores-fiscales.ts",
        nombre: "CLAVE_DE_CATEGORIA",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.arca.sin_datos": {
    porDefecto: "ARCA no tiene datos de ese comprobante.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/composicion/errores-fiscales.ts",
        nombre: "CLAVE_DE_CATEGORIA",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.arca.fuera_de_secuencia": {
    porDefecto:
      "La numeración no coincide con la que tiene ARCA. El punto de venta queda bloqueado hasta resincronizar.",
    largoMaximo: 200,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/composicion/errores-fiscales.ts",
        nombre: "CLAVE_DE_CATEGORIA",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.arca.punto_de_venta_no_habilitado": {
    porDefecto: "El punto de venta no está habilitado en ARCA para facturar con web service.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/composicion/errores-fiscales.ts",
        nombre: "TEXTO_DE_CODIGO_DE_ARCA",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.arca.receptor_para_a": {
    porDefecto: "Las facturas A necesitan el CUIT del cliente.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/composicion/errores-fiscales.ts",
        nombre: "TEXTO_DE_CODIGO_DE_ARCA",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.arca.receptor_sin_identificar": {
    porDefecto: "Para este importe ARCA exige identificar al cliente.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/composicion/errores-fiscales.ts",
        nombre: "TEXTO_DE_CODIGO_DE_ARCA",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.arca.receptor_igual_al_emisor": {
    porDefecto: "El documento del cliente no puede ser el mismo que el del emisor.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/composicion/errores-fiscales.ts",
        nombre: "TEXTO_DE_CODIGO_DE_ARCA",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.arca.receptor_no_categorizado": {
    porDefecto: "ARCA exige informar la percepción de IVA para un sujeto no categorizado.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/composicion/errores-fiscales.ts",
        nombre: "TEXTO_DE_CODIGO_DE_ARCA",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.arca.condicion_iva_del_receptor": {
    porDefecto: "La condición frente al IVA del cliente no corresponde a este tipo de comprobante.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/composicion/errores-fiscales.ts",
        nombre: "TEXTO_DE_CODIGO_DE_ARCA",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.arca.condicion_iva_obligatoria": {
    porDefecto: "Falta la condición frente al IVA del cliente.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/composicion/errores-fiscales.ts",
        nombre: "TEXTO_DE_CODIGO_DE_ARCA",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.arca.importes_no_cierran": {
    porDefecto: "Los importes del comprobante no cierran para ARCA.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/composicion/errores-fiscales.ts",
        nombre: "TEXTO_DE_CODIGO_DE_ARCA",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.arca.nota_sin_asociado": {
    porDefecto: "La nota necesita el comprobante que corrige.",
    largoMaximo: 160,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/composicion/errores-fiscales.ts",
        nombre: "TEXTO_DE_CODIGO_DE_ARCA",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.arca.nota_mayor_que_el_comprobante": {
    porDefecto:
      "La nota de crédito supera el importe del comprobante que corrige. ARCA la aprobó con esta observación.",
    largoMaximo: 200,
    usos: [
      {
        como: "FUNCION",
        archivo: "src/composicion/errores-fiscales.ts",
        nombre: "TEXTO_DE_CODIGO_DE_ARCA",
      },
    ],
    fuente: "HEREDADO",
  },
} as const;
