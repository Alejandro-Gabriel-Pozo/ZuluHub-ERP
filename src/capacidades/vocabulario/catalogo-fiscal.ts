/**
 * Los textos del facturador (H7 facturación) del catálogo de textos (`catalogo.ts`): los errores de negocio que puede ver la
 * persona al emitir, descartar, reintentar, resincronizar o cambiar el ambiente (`experiencia/respuesta-fiscal.ts`) y lo que
 * ARCA informó de un comprobante, traducido (`fiscal.arca.*`). Castellano neutro, en términos del negocio y sin nada técnico:
 * ningún texto crudo de ARCA llega a la pantalla. Viven en un archivo aparte para que el catálogo no crezca sin tope (cada
 * módulo suma los suyos); `catalogo.ts` los incluye y su prueba (`catalogo.test.ts`) los revisa como a todos.
 */
export const TEXTOS_DE_FISCAL = {
  "error.fiscal_datos_invalidos": {
    porDefecto:
      "Revise los datos del comprobante: hay campos incompletos o con un formato que no es válido.",
    largoMaximo: 160,
  },
  "error.fiscal_pedido_sin_identificar": {
    porDefecto: "No se pudo identificar el pedido. Actualice la pantalla e intente de nuevo.",
    largoMaximo: 160,
  },
  "error.fiscal_pedido_repetido": {
    porDefecto:
      "Ya existe un comprobante con esta misma referencia pero con otros datos. Cárguelo de nuevo desde el principio.",
    largoMaximo: 200,
  },
  "error.fiscal_punto_de_venta_no_encontrado": {
    porDefecto: "No se encontró el punto de venta.",
    largoMaximo: 160,
  },
  "error.fiscal_punto_de_venta_inactivo": {
    porDefecto: "El punto de venta está inactivo. Actívelo antes de emitir.",
    largoMaximo: 160,
  },
  "error.fiscal_emisor_inactivo": {
    porDefecto: "El emisor de este punto de venta está inactivo.",
    largoMaximo: 160,
  },
  "error.fiscal_sin_datos_fiscales": {
    porDefecto: "Faltan los datos fiscales confirmados de la empresa.",
    largoMaximo: 160,
  },
  "error.fiscal_sin_certificado": {
    porDefecto: "No hay un certificado de ARCA vigente para este punto de venta y ambiente.",
    largoMaximo: 160,
  },
  "error.fiscal_comprobante_no_encontrado": {
    porDefecto: "No encontramos ese comprobante.",
    largoMaximo: 160,
  },
  "error.fiscal_asociado_no_autorizado": {
    porDefecto: "Solo se puede corregir un comprobante que ARCA ya autorizó.",
    largoMaximo: 160,
  },
  "error.fiscal_asociado_de_otro_emisor": {
    porDefecto: "La nota debe ser del mismo emisor que el comprobante que corrige.",
    largoMaximo: 160,
  },
  "error.fiscal_asociado_de_otro_ambiente": {
    porDefecto:
      "La nota debe emitirse en el mismo ambiente (pruebas o producción) que el comprobante que corrige.",
    largoMaximo: 200,
  },
  "error.fiscal_asociado_no_asociable": {
    porDefecto: "No se puede emitir una nota sobre una nota de crédito.",
    largoMaximo: 160,
  },
  "error.fiscal_motivo_invalido": {
    porDefecto: "Escriba el motivo: es obligatorio y tiene un largo máximo.",
    largoMaximo: 160,
  },
  "error.fiscal_receptor_invalido": {
    porDefecto:
      "Revise los datos del cliente: nombre, documento, condición frente al IVA o domicilio.",
    largoMaximo: 160,
  },
  "error.fiscal_receptor_invalido_para_a": {
    porDefecto: "Una factura A necesita el CUIT del cliente.",
    largoMaximo: 160,
  },
  "error.fiscal_receptor_igual_al_emisor": {
    porDefecto: "El documento del cliente no puede ser el mismo que el de la empresa que factura.",
    largoMaximo: 160,
  },
  "error.fiscal_receptor_no_categorizado": {
    porDefecto: "Todavía no se pueden emitir comprobantes a un sujeto no categorizado.",
    largoMaximo: 160,
  },
  "error.fiscal_sin_renglones": {
    porDefecto: "Agregue al menos un renglón al comprobante.",
    largoMaximo: 160,
  },
  "error.fiscal_demasiados_renglones": {
    porDefecto: "El comprobante tiene más renglones de los permitidos.",
    largoMaximo: 160,
  },
  "error.fiscal_renglon_invalido": {
    porDefecto: "Hay un renglón con la descripción o la cantidad incompletas.",
    largoMaximo: 160,
  },
  "error.fiscal_alicuota_en_letra_c": {
    porDefecto: "Los comprobantes C no llevan alícuota de IVA en los renglones.",
    largoMaximo: 160,
  },
  "error.fiscal_falta_alicuota": {
    porDefecto: "Falta la alícuota de IVA en un renglón.",
    largoMaximo: 160,
  },
  "error.fiscal_modo_de_precio_invalido_para_c": {
    porDefecto: "Los comprobantes C se cargan con el IVA incluido en el precio.",
    largoMaximo: 160,
  },
  "error.fiscal_fechas_de_servicio_invalidas": {
    porDefecto:
      "Revise las fechas del servicio: son obligatorias para servicios y el período tiene que tener sentido.",
    largoMaximo: 200,
  },
  "error.fiscal_total_fuera_de_rango": {
    porDefecto: "El total del comprobante es demasiado grande o no es válido.",
    largoMaximo: 160,
  },
  "error.fiscal_comprobante_ya_enviado": {
    porDefecto: "El comprobante ya se envió a ARCA: espere su respuesta antes de descartarlo.",
    largoMaximo: 160,
  },
  "error.fiscal_estado_no_descartable": {
    porDefecto: "Este comprobante ya no se puede descartar.",
    largoMaximo: 160,
  },
  "error.fiscal_version_desactualizada": {
    porDefecto:
      "Los datos cambiaron mientras los miraba. Actualice la pantalla e intente de nuevo.",
    largoMaximo: 160,
  },
  "error.fiscal_serie_bloqueada": {
    porDefecto:
      "La numeración del punto de venta está bloqueada hasta que se resincronice con ARCA.",
    largoMaximo: 160,
  },
  "error.fiscal_estado_no_reintentable": {
    porDefecto: "Este comprobante no se puede reintentar en su estado actual.",
    largoMaximo: 160,
  },
  "error.fiscal_serie_no_encontrada": {
    porDefecto: "No se encontró la numeración de este punto de venta.",
    largoMaximo: 160,
  },
  "error.fiscal_serie_no_bloqueada": {
    porDefecto: "La numeración ya no está bloqueada: no hace falta resincronizar.",
    largoMaximo: 160,
  },
  "error.fiscal_ultimo_distinto_del_de_arca": {
    porDefecto:
      "ARCA informa otro último número que el que vio. Revise el dato y confirme de nuevo.",
    largoMaximo: 160,
  },
  "error.fiscal_desfase_hacia_atras": {
    porDefecto:
      "ARCA informa un número menor que el registrado y no se puede corregir desde acá. Consulte a soporte.",
    largoMaximo: 200,
  },
  "error.fiscal_arca_no_disponible": {
    porDefecto: "ARCA no está disponible en este momento. Intente de nuevo en unos minutos.",
    largoMaximo: 160,
  },
  "error.fiscal_arca_certificado_no_sirve": {
    porDefecto:
      "El certificado de ARCA de este punto de venta no se pudo usar. Revíselo o cárguelo de nuevo.",
    largoMaximo: 160,
  },
  "error.fiscal_arca_servicio_no_autorizado": {
    porDefecto:
      "El certificado no está autorizado en ARCA para facturar. Autorícelo en el Administrador de Relaciones de ARCA.",
    largoMaximo: 200,
  },
  "error.fiscal_arca_acceso_en_curso": {
    porDefecto:
      "ARCA ya tiene un acceso abierto para este certificado. Espere unos minutos e intente de nuevo.",
    largoMaximo: 160,
  },
  "error.fiscal_serie_en_curso": {
    porDefecto:
      "Hay un comprobante en proceso en este punto de venta. Espere a que termine para cambiar el ambiente.",
    largoMaximo: 200,
  },
  "error.fiscal_ambiente_no_vuelve": {
    porDefecto: "Un punto de venta que pasó a producción no vuelve al ambiente de pruebas.",
    largoMaximo: 160,
  },
  "error.fiscal_ya_emitio_en_produccion": {
    porDefecto: "Este punto de venta ya emitió en producción: no se puede cambiar de ambiente.",
    largoMaximo: 160,
  },
  "error.fiscal_filtro_invalido": {
    porDefecto: "Los filtros del listado no son válidos.",
    largoMaximo: 160,
  },
  // Fuente: `Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md`, D-36 («el servidor responde "sucursal no elegida"
  // y se pide elegir»; confirmada por el dueño el 2026-10-28) y D-34 (el servidor valida la sucursal elegida cada vez; el error
  // de una que no es de su alcance es `SUCURSAL_FUERA_DE_ALCANCE`, de `capacidades/permisos/alcance.ts`). Los TEXTOS son solo la
  // lectura literal de esos dos nombres: la pantalla se guía por el CÓDIGO (abre el selector). Texto de «no eligió sucursal»:
  // «Elegí una sucursal.» (dueño, 2026-10-29, respuesta en la sesión web del carril web); el de fuera de alcance sigue provisorio.
  "error.fiscal_sucursal_no_elegida": {
    porDefecto: "Elegí una sucursal.",
    largoMaximo: 160,
  },
  "error.fiscal_sucursal_fuera_de_alcance": {
    porDefecto: "Sucursal fuera de su alcance.",
    largoMaximo: 160,
  },
  // Fuente: `Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md`, D-50 («Una sucursal cerrada no emite»; confirmada
  // por el dueño el 2026-10-29: «No, una sucursal cerrada no emite»). El TEXTO es solo la lectura literal del nombre de la decisión: la
  // pantalla se guía por el CÓDIGO y el texto definitivo no está aprobado (pregunta pendiente).
  "error.fiscal_sucursal_cerrada": {
    porDefecto: "Sucursal cerrada.",
    largoMaximo: 160,
  },
  "fiscal.arca.error_generico": {
    porDefecto: "ARCA no aceptó el comprobante. Código {codigo}.",
    largoMaximo: 160,
    marcadores: ["codigo"],
  },
  "fiscal.arca.observacion_generica": {
    porDefecto: "ARCA agregó una observación al comprobante. Código {codigo}.",
    largoMaximo: 160,
    marcadores: ["codigo"],
  },
  "fiscal.arca.evento_generico": {
    porDefecto: "ARCA informó un evento sobre el comprobante. Código {codigo}.",
    largoMaximo: 160,
    marcadores: ["codigo"],
  },
  "fiscal.arca.autorizacion": {
    porDefecto:
      "ARCA no reconoció la autorización del certificado. Revise que esté autorizado para facturar.",
    largoMaximo: 200,
  },
  "fiscal.arca.problema_interno": {
    porDefecto:
      "ARCA tuvo un problema interno. El comprobante se confirma solo: no lo emita de nuevo.",
    largoMaximo: 200,
  },
  "fiscal.arca.sin_datos": {
    porDefecto: "ARCA no tiene datos de ese comprobante.",
    largoMaximo: 160,
  },
  "fiscal.arca.fuera_de_secuencia": {
    porDefecto:
      "La numeración no coincide con la que tiene ARCA. El punto de venta queda bloqueado hasta resincronizar.",
    largoMaximo: 200,
  },
  "fiscal.arca.punto_de_venta_no_habilitado": {
    porDefecto: "El punto de venta no está habilitado en ARCA para facturar con web service.",
    largoMaximo: 160,
  },
  "fiscal.arca.receptor_para_a": {
    porDefecto: "Las facturas A necesitan el CUIT del cliente.",
    largoMaximo: 160,
  },
  "fiscal.arca.receptor_sin_identificar": {
    porDefecto: "Para este importe ARCA exige identificar al cliente.",
    largoMaximo: 160,
  },
  "fiscal.arca.receptor_igual_al_emisor": {
    porDefecto: "El documento del cliente no puede ser el mismo que el del emisor.",
    largoMaximo: 160,
  },
  "fiscal.arca.receptor_no_categorizado": {
    porDefecto: "ARCA exige informar la percepción de IVA para un sujeto no categorizado.",
    largoMaximo: 160,
  },
  "fiscal.arca.condicion_iva_del_receptor": {
    porDefecto: "La condición frente al IVA del cliente no corresponde a este tipo de comprobante.",
    largoMaximo: 160,
  },
  "fiscal.arca.condicion_iva_obligatoria": {
    porDefecto: "Falta la condición frente al IVA del cliente.",
    largoMaximo: 160,
  },
  "fiscal.arca.importes_no_cierran": {
    porDefecto: "Los importes del comprobante no cierran para ARCA.",
    largoMaximo: 160,
  },
  "fiscal.arca.nota_sin_asociado": {
    porDefecto: "La nota necesita el comprobante que corrige.",
    largoMaximo: 160,
  },
  "fiscal.arca.nota_mayor_que_el_comprobante": {
    porDefecto:
      "La nota de crédito supera el importe del comprobante que corrige. ARCA la aprobó con esta observación.",
    largoMaximo: 200,
  },
} as const;
