/**
 * Los textos del módulo `compras` (prefijo `compras.`, E9-T15; `e9-compras-especificacion.md` §10). Ninguno es nuevo: todos salen de los que el
 * dueño aprobó el 09/11/2026 en los prototipos `compra.html` («Textos aprobados»), `control.html` y `orden.html` («Textos nuevos»), que son la
 * fuente de cada grupo de abajo (repositorio de documentos, `10-ux-ui/prototipos-gastronomia/`). Lo que esa lista no trae no se agrega acá: los
 * errores sin texto aprobado (`CLAVE_REUTILIZADA`, `COMPRA_CONSUMIDA`, `COMPROBANTE_YA_PAGADO`, `COMPROBANTE_NO_PAGABLE`, `CORRECCION_DESACTUALIZADA`,
 * `SIN_CAMBIOS`, `MOTIVO_REQUERIDO`, `PROVEEDOR_CON_OTRO_DOCUMENTO`, `FECHA_INVALIDA`, `MEDIO_INVALIDO`, `CONVERSION_NO_EXACTA`,
 * `DIMENSION_DISTINTA`, `PRODUCTO_NO_COMPRABLE`, `FUNCION_NO_INCLUIDA`, `*_DESACTUALIZADA`) se muestran con el mensaje genérico que ya existe, y las
 * pantallas de pago y de corrección no tienen texto ni prototipo (D142 y D143; decisión D175). Un texto repetido en dos filas de los prototipos
 * («Pedida», «Cuarentena») tiene una sola clave, la del primer grupo.
 */
export const TEXTOS_DE_COMPRAS = {
  // compra.html, «Textos aprobados» (09/11/2026), filas «Lista» y «Nueva compra» (D175: «Recibida sin facturar» y «Comprar y recibir» son de la decisión 35)
  "compras.compra.compras": { porDefecto: "Compras" },
  // «Compra» antes del número («Compra 5 · Carnes del Sur», título de la ficha): `compra-corregir-anular.html` (`vLista`, `vFicha`), aceptada por delegación (DDD:187). Distinta de `stock.motivo.compra` (motivo de un movimiento): otro uso, otra clave.
  "compras.compra.compra": {
    porDefecto: "Compra",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/compras/textos-de-compras.ts",
        nombre: "textosDeCompras",
      },
    ],
    fuente: { decision: "DEC-0838" },
  },
  // «Nivel de compras» (Compras PR 11): el nombre de la pantalla y los dos niveles que se eligen (N1 y N2). Los tres los aprobó el dueño tal cual el 24/11/2026 (`compra-nivel.html`; nombres de DDD:120 punto 3). «Recepción separada» y «Tres vías» (aprobados) son de la fase 5, pausada: no tienen clave hasta que se construyan.
  "compras.nivel.titulo": {
    porDefecto: "Nivel de compras",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/compras/nivel/textos-de-nivel-de-compras.ts",
        nombre: "textosDeNivelDeCompras",
      },
      { como: "FUNCION", archivo: "apps/web/ui/navegacion/menu.ts", nombre: "FILAS_DEL_MENU" },
    ],
    fuente: { decision: "DEC-0870" },
  },
  "compras.nivel.compra_simple": {
    porDefecto: "Sin factura",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/compras/nivel/textos-de-nivel-de-compras.ts",
        nombre: "textosDeNivelDeCompras",
      },
    ],
    fuente: { decision: "DEC-0870" },
  },
  "compras.nivel.con_comprobante": {
    porDefecto: "Con factura",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/compras/nivel/textos-de-nivel-de-compras.ts",
        nombre: "textosDeNivelDeCompras",
      },
    ],
    fuente: { decision: "DEC-0870" },
  },
  // «Corregir» y «Antes» (Compras PR 10; `compra-corregir-anular.html`): «Corregir» es el verbo de corregir una línea (aceptado por delegación, DDD:173/174; ya no hay otro «Corregir» solo en el catálogo) y «Antes» el del precio de antes de una corrección (aprobado el 09/11/2026, `compra.html:373`).
  "compras.correccion.corregir": {
    porDefecto: "Corregir",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/compras/textos-de-compras.ts",
        nombre: "textosDeCompras",
      },
    ],
    fuente: { decision: "DEC-0871" },
  },
  "compras.correccion.antes": {
    porDefecto: "Antes",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/compras/textos-de-compras.ts",
        nombre: "textosDeCompras",
      },
    ],
    fuente: { decision: "DEC-0871" },
  },
  "compras.compra.por_recibir": { porDefecto: "Por recibir" },
  "compras.compra.sin_facturar": { porDefecto: "Sin facturar" },
  "compras.compra.pedida": { porDefecto: "Pedida" },
  "compras.compra.recibida_parcial": { porDefecto: "Recibida parcial" },
  "compras.compra.recibida_sin_facturar": { porDefecto: "Recibida sin facturar" },
  "compras.compra.facturada_falta_recibir": { porDefecto: "Facturada, falta recibir" },
  "compras.compra.la_factura_llego_antes_que_la_mercaderia": {
    porDefecto: "La factura llegó antes que la mercadería",
  },
  "compras.compra.el_stock_no_entra_hasta_recibirla": {
    porDefecto: "El stock no entra hasta recibirla",
  },
  "compras.compra.nueva_compra": { porDefecto: "Nueva compra" },
  "compras.compra.proveedor": { porDefecto: "Proveedor" },
  "compras.compra.como_se_compra": { porDefecto: "Cómo se compra" },
  "compras.compra.cantidad": { porDefecto: "Cantidad" },
  "compras.compra.precio_por": { porDefecto: "Precio por" },
  "compras.compra.entra_a_tu_stock": { porDefecto: "Entra a tu stock" },
  "compras.compra.costo_por_unidad_de_stock": { porDefecto: "Costo por unidad de stock" },
  "compras.compra.pedir": { porDefecto: "Pedir" },
  "compras.compra.comprar_y_recibir": { porDefecto: "Comprar y recibir" },

  // compra.html, «Textos aprobados», filas «Recepción» y «Nueva compra y recepción»; las claves de «Confirmar recepción» y «se confirma al pesar» dicen «validar» porque el catálogo rechaza todo nombre que contenga «firma» (`NOMBRE_DE_SECRETO`)
  "compras.recepcion.recibir": { porDefecto: "Recibir" },
  "compras.recepcion.cantidad_recibida": { porDefecto: "Cantidad recibida" },
  "compras.recepcion.peso_recibido": { porDefecto: "Peso recibido" },
  "compras.recepcion.validar_recepcion": { porDefecto: "Confirmar recepción" },
  "compras.recepcion.caja_de_peso_variable": { porDefecto: "Caja de peso variable" },
  "compras.recepcion.el_peso_real_se_carga_al_recibir": {
    porDefecto: "el peso real se carga al recibir",
  },
  "compras.recepcion.se_valida_al_pesar": { porDefecto: "se confirma al pesar" },
  "compras.recepcion.falta_pesar": { porDefecto: "Falta pesar" },
  "compras.recepcion.total_de_la_linea": { porDefecto: "Total de la línea" },
  "compras.recepcion.remito_del_proveedor": { porDefecto: "Remito del proveedor" },
  "compras.recepcion.sin_remito": { porDefecto: "Sin remito" },
  "compras.recepcion.fecha_del_remito": { porDefecto: "Fecha del remito" },
  // «Depósito» (singular de «Depósitos», `stock.pantalla.depositos`): selector del depósito de «Nueva compra» (Compras PR 6b). Aceptado por delegación de textos (DDD:173), el 24/11/2026.
  "compras.compra.deposito": {
    porDefecto: "Depósito",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/compras/nueva/textos-de-nueva-compra.ts",
        nombre: "textosDeNuevaCompra",
      },
    ],
    fuente: { decision: "DEC-0864" },
  },
  // «Número» del remito (compra.html, «Textos aprobados», fila «Remito del proveedor · Punto de venta · Número · Fecha del remito · Sin remito», aprobada el 09/11/2026): Compras PR 6b.
  "compras.recepcion.numero": {
    porDefecto: "Número",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/compras/nueva/textos-de-nueva-compra.ts",
        nombre: "textosDeNuevaCompra",
      },
    ],
    fuente: { decision: "DEC-0861" },
  },

  // compra.html, «Textos aprobados», filas «Nueva compra», «Pool», «Ficha del proveedor», «Ficha y carga de factura y nota» y «Pedidos de quien carga compras»
  "compras.ficha.agregar_proveedor": { porDefecto: "Agregar proveedor" },
  "compras.ficha.ya_existe_un_proveedor_con_ese_nombre": {
    porDefecto: "Ya existe un proveedor con ese nombre",
  },
  "compras.ficha.cuit": { porDefecto: "CUIT" },
  "compras.ficha.condicion_frente_al_iva": { porDefecto: "Condición frente al IVA" },
  "compras.ficha.datos_del_directorio": { porDefecto: "Datos del directorio" },
  "compras.ficha.comprobantes_que_emite": { porDefecto: "Comprobantes que emite" },
  "compras.ficha.puntos_de_venta": { porDefecto: "Puntos de venta" },
  "compras.ficha.que_le_compramos": { porDefecto: "Qué le compramos" },
  "compras.ficha.facturas_y_notas": { porDefecto: "Facturas y notas" },
  "compras.ficha.agregar_punto_de_venta": { porDefecto: "Agregar punto de venta" },
  "compras.ficha.dejar_de_usar": { porDefecto: "Dejar de usar" },
  "compras.ficha.pedir_punto_de_venta": { porDefecto: "Pedir punto de venta" },
  "compras.ficha.pedir_otro_comprobante": { porDefecto: "Pedir otro comprobante" },
  "compras.ficha.enviar_pedido": { porDefecto: "Enviar pedido" },
  "compras.ficha.pedidos_pendientes": { porDefecto: "Pedidos pendientes" },
  "compras.ficha.aprobar": { porDefecto: "Aprobar" },
  "compras.ficha.rechazar": { porDefecto: "Rechazar" },
  "compras.ficha.proveedores_del_producto": { porDefecto: "Proveedores del producto" },
  "compras.ficha.mas_barato_por_unidad": { porDefecto: "Más barato por unidad" },

  // compra.html:332-333 (aprobados el 09/11/2026, DEC-0565): ficha del proveedor, sin clave hasta C0 (`pantallas-de-compras-inventario.md` §5)
  "compras.ficha.ver_todas": { porDefecto: "Ver todas" },
  "compras.ficha.por_ser": { porDefecto: "Por ser" },
  "compras.ficha.emite": { porDefecto: "emite" },
  "compras.ficha.condicion_no_define_la_letra": {
    porDefecto: "Su condición no define la letra: se elige a mano",
  },
  "compras.ficha.todavia_no_se_le_compro_nada": { porDefecto: "Todavía no se le compró nada" },
  "compras.ficha.todavia_no_tiene_facturas": { porDefecto: "Todavía no tiene facturas" },
  "compras.ficha.ninguno_cargado": { porDefecto: "Ninguno cargado" },
  "compras.ficha.sin_puntos_de_venta": { porDefecto: "Sin puntos de venta" },
  "compras.ficha.ultima_compra": { porDefecto: "Última compra" },
  "compras.ficha.agregar_otro_comprobante": { porDefecto: "Agregar otro comprobante" },

  // compra.html:334-335 (aprobados el 09/11/2026, DEC-0565): pedidos de quien carga compras y modales de confirmación («Cancelar» es de uso común y ya existe)
  "compras.ficha.pedido_lo_aprueba_quien_administra": {
    porDefecto:
      "Lo tiene que aprobar quien administra. Hasta entonces no se puede usar en una factura",
    largoMaximo: 120,
  },
  "compras.ficha.pedido_el": { porDefecto: "Pedido el" },
  "compras.ficha.pedido_pendiente": { porDefecto: "Pedido pendiente" },
  "compras.ficha.falta_que_lo_apruebe": { porDefecto: "Falta que lo apruebe quien administra" },
  "compras.ficha.se_agrega_a_la_ficha_de": { porDefecto: "Se agrega a la ficha de" },
  "compras.ficha.despues_solo_se_elige_entre_los_de_la_ficha": {
    porDefecto: "Después solo se puede elegir entre los puntos de venta de la ficha",
  },
  "compras.ficha.numero_del_punto_de_venta": { porDefecto: "Número del punto de venta" },
  "compras.ficha.las_facturas_cargadas_no_cambian": {
    porDefecto:
      "Las facturas ya cargadas no cambian. Si el proveedor vuelve a usarlo, se agrega de nuevo",
    largoMaximo: 120,
  },
  "compras.ficha.agregar": { porDefecto: "Agregar" },

  // compra.html, «Textos aprobados», filas «Compra y carga de factura», «Carga de factura» y «Carga de la nota de crédito»
  "compras.factura.cargar_factura": { porDefecto: "Cargar factura" },
  "compras.factura.comprobante": { porDefecto: "Comprobante" },
  "compras.factura.tipo": { porDefecto: "Tipo" },
  "compras.factura.fecha_de_la_factura": { porDefecto: "Fecha de la factura" },
  "compras.factura.vencimiento_de_pago": { porDefecto: "Vencimiento de pago" },
  "compras.factura.cantidad_facturada": { porDefecto: "Cantidad facturada" },
  "compras.factura.precio_neto": { porDefecto: "Precio neto" },
  "compras.factura.iva": { porDefecto: "IVA" },
  "compras.factura.importes": { porDefecto: "Importes" },
  "compras.factura.percepciones": { porDefecto: "Percepciones" },
  "compras.factura.total_calculado": { porDefecto: "Total calculado" },
  "compras.factura.total_segun_la_factura": { porDefecto: "Total según la factura" },
  "compras.factura.cargar_nota_de_credito": { porDefecto: "Cargar nota de crédito" },
  "compras.factura.factura_que_corrige": { porDefecto: "Factura que corrige" },
  "compras.factura.importe_con_iva": { porDefecto: "Importe con IVA" },
  "compras.factura.notas_de_credito": { porDefecto: "Notas de crédito" },
  "compras.factura.a_solicitar": { porDefecto: "A solicitar" },
  "compras.factura.solicitada": { porDefecto: "Solicitada" },
  "compras.factura.recibida": { porDefecto: "Recibida" },
  "compras.factura.aplicada": { porDefecto: "Aplicada" },

  // compra.html:336, 340 y 341 (aprobados el 09/11/2026, DEC-0565; «Falta la factura» es de la decisión 35 del dueño, compra.html:340): carga de factura
  "compras.factura.sin_iva_discriminado": {
    porDefecto: "Sin IVA discriminado: es un comprobante B o C",
  },
  "compras.factura.neto_sin_iva_discriminado": { porDefecto: "Neto (sin IVA discriminado)" },
  "compras.factura.neto_de_la_linea": { porDefecto: "Neto de la línea" },
  "compras.factura.falta_la_factura": { porDefecto: "Falta la factura" },

  // control.html, «Textos nuevos» (09/11/2026), N3 apagado por perilla (T13): se declaran juntos para que el catálogo quede completo con lo aprobado
  "compras.control.lote": { porDefecto: "Lote" },
  "compras.control.vence": { porDefecto: "Vence" },
  "compras.control.temperatura": { porDefecto: "Temperatura" },
  // Aprobado por el dueño el 14/11/2026 (decisiones-del-dueno-2026-11.md, fila «Textos y plan», punto 2; `temperatura-de-recepcion.md` #2).
  "compras.control.falta_la_temperatura": { porDefecto: "Falta la temperatura" },
  "compras.control.condicion": { porDefecto: "Condición" },
  "compras.control.conforme": { porDefecto: "Conforme" },
  "compras.control.con_observaciones": { porDefecto: "Con observaciones" },
  "compras.control.rechazada": { porDefecto: "Rechazada" },
  "compras.control.motivo_del_rechazo": { porDefecto: "Motivo del rechazo" },
  "compras.control.observacion": { porDefecto: "Observación" },
  "compras.control.queda_en_cuarentena": { porDefecto: "Queda en cuarentena" },
  "compras.control.se_rechaza": { porDefecto: "Se rechaza" },
  "compras.control.cuarentena": { porDefecto: "Cuarentena" },
  "compras.control.en_revision": { porDefecto: "En revisión" },
  "compras.control.liberar": { porDefecto: "Liberar" },
  "compras.control.devolver_al_proveedor": { porDefecto: "Devolver al proveedor" },
  "compras.control.cantidad_a_devolver": { porDefecto: "Cantidad a devolver" },
  "compras.control.motivo_de_la_devolucion": { porDefecto: "Motivo de la devolución" },
  "compras.control.calidad": { porDefecto: "Calidad" },
  "compras.control.vencida_al_recibir": { porDefecto: "Vencida al recibir" },
  "compras.control.error_del_proveedor": { porDefecto: "Error del proveedor" },
  "compras.control.se_pide_la_nota_de_credito": { porDefecto: "Se pide la nota de crédito" },

  // orden.html, «Textos nuevos» (09/11/2026), N4 apagado por perilla (T14)
  "compras.orden.ordenes_de_compra": { porDefecto: "Órdenes de compra" },
  "compras.orden.nueva_orden": { porDefecto: "Nueva orden" },
  "compras.orden.borrador": { porDefecto: "Borrador" },
  "compras.orden.cerrada": { porDefecto: "Cerrada" },
  "compras.orden.anulada": { porDefecto: "Anulada" },
  "compras.orden.sin_recibir": { porDefecto: "Sin recibir" },
  "compras.orden.sucursal_de_destino": { porDefecto: "Sucursal de destino" },
  "compras.orden.entrega_prevista": { porDefecto: "Entrega prevista" },
  "compras.orden.cerrar_con_saldo": { porDefecto: "Cerrar con saldo" },
  "compras.orden.reemplazar": { porDefecto: "Reemplazar" },

  // compra.html: «Ese remito ya está cargado» y «Está en la compra» (REMITO_YA_REGISTRADO), «Esa factura ya está cargada» y «Esa nota ya está cargada» (COMPROBANTE_YA_REGISTRADO), «Falta declarar los puntos de venta» y «Sin ellos no se puede cargar una factura» (PUNTO_DE_VENTA_NO_DECLARADO), avisos de letra y de total; errores de orden.html y stock.html (CANTIDAD_INVALIDA, PRECIO_INVALIDO, PROVEEDOR_NO_ENCONTRADO)
  "compras.error.remito_ya_registrado": { porDefecto: "Ese remito ya está cargado" },
  "compras.error.remito_ya_registrado_detalle": { porDefecto: "Está en la compra" },
  "compras.error.comprobante_ya_registrado": { porDefecto: "Esa factura ya está cargada" },
  "compras.error.nota_ya_registrada": { porDefecto: "Esa nota ya está cargada" },
  "compras.error.punto_de_venta_no_declarado": { porDefecto: "Falta declarar los puntos de venta" },
  "compras.error.punto_de_venta_no_declarado_detalle": {
    porDefecto: "Sin ellos no se puede cargar una factura",
  },
  "compras.error.letra_proveedor_emite": { porDefecto: "Este proveedor emite" },
  "compras.error.letra_esta_es": { porDefecto: "Esta es" },
  "compras.error.letra_se_carga_igual": { porDefecto: "Se carga igual, tal como vino" },
  "compras.error.total_coincide": { porDefecto: "El total coincide con la factura" },
  "compras.error.total_no_coincide": { porDefecto: "El total no coincide" },
  "compras.error.cantidad_invalida": { porDefecto: "La cantidad tiene que ser mayor que cero" },
  "compras.error.precio_invalido": { porDefecto: "Escribí un precio válido" },
  "compras.error.proveedor_no_encontrado": { porDefecto: "El proveedor ya no está disponible" },
  "compras.error.sin_permiso": { porDefecto: "Esta acción no está permitida" },
  // compra-pago.html, «Textos nuevos»: el botón del pago de una factura, elegido por el dueño el 16/11/2026 (2A, `DEC-0891`): Compras PR 8.
  "compras.pago.declarar": {
    porDefecto: "Declarar pago",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/compras/textos-de-compras.ts",
        nombre: "textosDeCompras",
      },
    ],
    fuente: { decision: "DEC-0891" },
  },
} as const;
