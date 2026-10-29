/**
 * Esquema de base del módulo fiscal: las siete tablas de `0006_fiscal.sql` (con el `ambiente` que les
 * suma `0009_facturacion.sql`) y las seis de la facturación de 0009 (comprobante, renglones, desglose,
 * certificados, accesos e intentos; spec H7 facturación §B.8). Lo comparan las pruebas de integración
 * contra la base real: si una columna o una restricción cambia en el SQL, estas listas tienen que
 * cambiar con ella.
 */

/** Columnas de cada tabla, en el orden de la base. */
export const COLUMNAS_DE_FISCAL = {
  provincia: ["codigo", "nombre", "codigo_arca"],
  emisor: [
    "id",
    "empresa_id",
    "es_principal",
    "activo",
    "cuit",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  domicilio: [
    "id",
    "empresa_id",
    "calle",
    "numero",
    "piso",
    "departamento",
    "localidad",
    "provincia",
    "codigo_postal",
    "creado_en",
  ],
  datos_fiscales: [
    "id",
    "empresa_id",
    "emisor_id",
    "estado",
    "numero",
    "razon_social",
    "condicion_iva",
    "domicilio_fiscal_id",
    "inicio_actividades",
    "iibb_numero",
    "iibb_condicion",
    "vigente_desde",
    "confirmada_en",
    "confirmada_por",
    "motivo",
    "creado_por",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  regla_emisor: [
    "id",
    "empresa_id",
    "estado",
    "numero",
    "permitir_eleccion_manual",
    "vigente_desde",
    "confirmada_en",
    "confirmada_por",
    "motivo",
    "creado_por",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  punto_de_venta: [
    "id",
    "empresa_id",
    "emisor_id",
    "sucursal_id",
    "domicilio_id",
    "numero",
    "estado",
    "verificacion_arca",
    "creado_en",
    "actualizado_en",
    "version",
    "ambiente",
  ],
  serie_comprobante: [
    "empresa_id",
    "punto_de_venta_id",
    "emisor_id",
    "tipo_comprobante",
    "ultimo_numero",
    "estado",
    "numero_en_curso",
    "solicitud_en_curso",
    "en_curso_hasta",
    "motivo_bloqueo",
    "creado_en",
    "actualizado_en",
    "version",
    "ambiente",
  ],
  comprobante: [
    "id",
    "empresa_id",
    "emisor_id",
    "punto_de_venta_id",
    "ambiente",
    "origen_tipo",
    "origen_id",
    "clase",
    "tipo_comprobante",
    "concepto",
    "servicio_desde",
    "servicio_hasta",
    "vencimiento_pago",
    "moneda",
    "modo_de_precio",
    "total",
    "neto_gravado",
    "iva",
    "exento",
    "no_gravado",
    "datos_fiscales_id",
    "emisor_cuit",
    "emisor_razon_social",
    "emisor_condicion_iva",
    "emisor_domicilio_fiscal",
    "emisor_inicio_actividades",
    "emisor_iibb_numero",
    "emisor_iibb_condicion",
    "punto_de_venta_numero",
    "punto_de_venta_domicilio",
    "receptor_parte_id",
    "receptor_nombre",
    "receptor_documento_tipo",
    "receptor_documento_numero",
    "receptor_condicion_iva",
    "receptor_domicilio",
    "comprobante_asociado_id",
    "motivo",
    "estado",
    "envios",
    "numero_reservado",
    "fecha_emision",
    "numero",
    "cae",
    "cae_vence",
    "autorizado_en",
    "resuelto_por",
    "motivo_descarte",
    "huella",
    "version_de_representacion",
    "creado_por",
    "creado_en",
    "actualizado_en",
    "version",
    "sucursal_id",
  ],
  comprobante_linea: [
    "empresa_id",
    "comprobante_id",
    "posicion",
    "descripcion",
    "cantidad",
    "precio_unitario",
    "descuento",
    "alicuota",
    "importe",
  ],
  comprobante_alicuota: ["empresa_id", "comprobante_id", "alicuota", "total", "neto", "iva"],
  certificado_arca: [
    "id",
    "empresa_id",
    "emisor_id",
    "ambiente",
    "alias",
    "cuit_titular",
    "estado",
    "pedido_pem",
    "certificado_pem",
    "huella_sha256",
    "vence_en",
    "autorizacion_verificada_en",
    "clave_cifrada",
    "clave_nonce",
    "clave_etiqueta",
    "clave_kid",
    "creado_por",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  acceso_arca: [
    "empresa_id",
    "certificado_id",
    "servicio",
    "credencial_cifrada",
    "credencial_nonce",
    "credencial_etiqueta",
    "credencial_kid",
    "generado_en",
    "expira_en",
    "renovando_hasta",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  intento_arca: [
    "id",
    "empresa_id",
    "comprobante_id",
    "operacion",
    "numero",
    "desenlace",
    "mensajes",
    "respuesta",
    "huella_pedido",
    "iniciado_en",
    "duracion_ms",
  ],
} as const;

/**
 * Restricción de la base → error de negocio (ADR-004). Un test exige que no falte ninguna y que no
 * sobre ninguna. `NO_TRADUCIDA`: no tiene un error de negocio propio (el dominio decide antes; si
 * salta, es un defecto). Los nombres que coinciden con un error del dominio fiscal (por ejemplo
 * `PUNTO_DE_VENTA_DUPLICADO`) son ese mismo error: el caso de uso lo declara una sola vez.
 *
 * Los 35 nombres que lanzan los disparadores (`CONSTRAINT = '...'` en 0006 y 0009) están al final de cada
 * tabla, marcados «lo lanza un disparador», y NINGUNO es `NO_TRADUCIDA`. Dos de ellos viven en
 * `empresa` (`empresa_cuit_es_emisor`, `empresa_cuit_inmutable`): los lanza el alta o la corrección
 * del CUIT de una empresa y el caso de uso de plataforma que los hace los traduce con este mapa.
 *
 * Criterio de 0009 (F3), el mismo de 0006: una restricción tiene motivo cuando un valor que escribe una
 * persona (texto libre, largo, rango) o una carrera entre transacciones la puede hacer saltar; es
 * `NO_TRADUCIDA` cuando es un catálogo cerrado o un emparejamiento que los tipos del dominio vuelven
 * imposible de armar mal (si salta, es un defecto: sale tal cual como `ErrorDePersistencia`). Los
 * motivos con el nombre de un error del dominio de la facturación (`MODO_DE_PRECIO_INVALIDO_PARA_C`,
 * `FECHAS_DE_SERVICIO_INVALIDAS`, `DEMASIADOS_RENGLONES`, `MOTIVO_INVALIDO`, `NUMERO_DUPLICADO`,
 * `SERIE_OCUPADA`) son ese mismo error: el caso de uso lo declara una sola vez.
 */
export const ERRORES_DE_FISCAL_POR_RESTRICCION = {
  // provincia: catálogo global, solo lo escribe la migración
  provincia_pkey: "NO_TRADUCIDA",
  provincia_codigo_ck: "NO_TRADUCIDA",
  provincia_nombre_uk: "NO_TRADUCIDA",
  provincia_codigo_arca_uk: "NO_TRADUCIDA",

  // empresa (de 0001): los dos disparadores cruzados con el emisor
  empresa_cuit_es_emisor: "CUIT_EN_USO", // lo lanza un disparador
  empresa_cuit_inmutable: "CUIT_INMUTABLE", // lo lanza un disparador

  // emisor
  emisor_pkey: "NO_TRADUCIDA",
  emisor_empresa_id_fkey: "EMPRESA_INEXISTENTE",
  emisor_id_empresa_uk: "NO_TRADUCIDA",
  emisor_cuit_ck: "CUIT_INVALIDO",
  emisor_principal_activo_ck: "EMISOR_PRINCIPAL_NO_SE_DESACTIVA",
  emisor_principal_uk: "NO_TRADUCIDA", // lo crea el disparador de la empresa; si salta, es un defecto
  emisor_cuit_uk: "CUIT_EN_USO",
  emisor_inmutable: "EMISOR_INMUTABLE", // lo lanza un disparador
  emisor_empresa_no_operable: "EMPRESA_NO_OPERABLE", // lo lanza un disparador
  emisor_cuit_es_empresa: "CUIT_EN_USO", // lo lanza un disparador
  emisor_cuit_inmutable: "CUIT_INMUTABLE", // lo lanza un disparador
  emisor_con_pv_activos: "EMISOR_CON_PUNTOS_DE_VENTA_ACTIVOS", // lo lanza un disparador

  // domicilio (solo inserción)
  domicilio_pkey: "NO_TRADUCIDA",
  domicilio_empresa_id_fkey: "EMPRESA_INEXISTENTE",
  domicilio_id_empresa_uk: "NO_TRADUCIDA",
  domicilio_calle_ck: "CALLE_INVALIDA",
  domicilio_numero_ck: "NUMERO_INVALIDO",
  domicilio_piso_ck: "PISO_INVALIDO",
  domicilio_departamento_ck: "DEPARTAMENTO_INVALIDO",
  domicilio_localidad_ck: "LOCALIDAD_INVALIDA",
  domicilio_provincia_fkey: "PROVINCIA_INVALIDA",
  domicilio_codigo_postal_ck: "CODIGO_POSTAL_INVALIDO",

  // datos_fiscales
  datos_fiscales_pkey: "NO_TRADUCIDA",
  datos_fiscales_empresa_id_fkey: "EMPRESA_INEXISTENTE",
  datos_fiscales_confirmada_por_fkey: "PERSONA_INEXISTENTE",
  datos_fiscales_creado_por_fkey: "PERSONA_INEXISTENTE",
  datos_fiscales_emisor_fkey: "EMISOR_NO_ENCONTRADO",
  datos_fiscales_domicilio_fkey: "DOMICILIO_NO_ENCONTRADO",
  datos_fiscales_numero_uk: "NUMERO_DE_VERSION_INVALIDO",
  datos_fiscales_estado_ck: "NO_TRADUCIDA",
  datos_fiscales_razon_social_ck: "RAZON_SOCIAL_INVALIDA",
  datos_fiscales_condicion_iva_ck: "CONDICION_IVA_INVALIDA",
  datos_fiscales_inicio_actividades_ck: "INICIO_DE_ACTIVIDADES_INVALIDO",
  datos_fiscales_iibb_numero_ck: "IIBB_NUMERO_INVALIDO",
  datos_fiscales_iibb_condicion_ck: "IIBB_CONDICION_INVALIDA",
  datos_fiscales_motivo_ck: "MOTIVO_OBLIGATORIO",
  datos_fiscales_confirmada_ck: "NO_TRADUCIDA", // el dominio decide antes (incompleta, vigencia retroactiva)
  datos_fiscales_id_empresa_emisor_uk: "NO_TRADUCIDA", // 0009: para la clave foránea compuesta del comprobante
  datos_fiscales_borrador_uk: "YA_HAY_BORRADOR",
  datos_fiscales_transicion_invalida: "VERSION_TRANSICION_INVALIDA", // lo lanza un disparador
  datos_fiscales_inmutable: "VERSION_INMUTABLE", // lo lanza un disparador
  datos_fiscales_confirmada_inmutable: "VERSION_CONFIRMADA_INMUTABLE", // lo lanza un disparador
  datos_fiscales_numero_invalido: "NUMERO_DE_VERSION_INVALIDO", // lo lanza un disparador

  // regla_emisor
  regla_emisor_pkey: "NO_TRADUCIDA",
  regla_emisor_empresa_id_fkey: "EMPRESA_INEXISTENTE",
  regla_emisor_confirmada_por_fkey: "PERSONA_INEXISTENTE",
  regla_emisor_creado_por_fkey: "PERSONA_INEXISTENTE",
  regla_emisor_numero_uk: "NUMERO_DE_VERSION_INVALIDO",
  regla_emisor_estado_ck: "NO_TRADUCIDA",
  regla_emisor_motivo_ck: "MOTIVO_OBLIGATORIO",
  regla_emisor_confirmada_ck: "NO_TRADUCIDA", // el dominio decide antes
  regla_emisor_borrador_uk: "YA_HAY_BORRADOR",
  regla_emisor_transicion_invalida: "VERSION_TRANSICION_INVALIDA", // lo lanza un disparador
  regla_emisor_inmutable: "VERSION_INMUTABLE", // lo lanza un disparador
  regla_emisor_confirmada_inmutable: "VERSION_CONFIRMADA_INMUTABLE", // lo lanza un disparador
  regla_emisor_numero_invalido: "NUMERO_DE_VERSION_INVALIDO", // lo lanza un disparador

  // punto_de_venta
  punto_de_venta_pkey: "NO_TRADUCIDA",
  punto_de_venta_empresa_id_fkey: "EMPRESA_INEXISTENTE",
  punto_de_venta_emisor_fkey: "EMISOR_NO_ENCONTRADO",
  punto_de_venta_sucursal_fkey: "SUCURSAL_DE_OTRA_EMPRESA",
  punto_de_venta_domicilio_fkey: "DOMICILIO_NO_ENCONTRADO",
  punto_de_venta_numero_ck: "PUNTO_DE_VENTA_NUMERO_INVALIDO",
  punto_de_venta_estado_ck: "NO_TRADUCIDA",
  punto_de_venta_verificacion_ck: "NO_TRADUCIDA",
  punto_de_venta_numero_uk: "PUNTO_DE_VENTA_DUPLICADO",
  punto_de_venta_serie_uk: "NO_TRADUCIDA",
  punto_de_venta_domicilio_ck: "PUNTO_DE_VENTA_SIN_DOMICILIO",
  punto_de_venta_inmutable: "PUNTO_DE_VENTA_EMISOR_INMUTABLE", // lo lanza un disparador
  punto_de_venta_numero_inmutable: "PUNTO_DE_VENTA_NUMERO_INMUTABLE", // lo lanza un disparador
  punto_de_venta_emisor_inactivo: "EMISOR_INACTIVO", // lo lanza un disparador
  // 0009: el ambiente del punto de venta (QF2). El CHECK lo decide el dominio; los dos disparadores son errores de negocio.
  punto_de_venta_ambiente_ck: "NO_TRADUCIDA",
  punto_de_venta_ambiente_con_serie_en_curso: "SERIE_EN_CURSO", // lo lanza un disparador
  punto_de_venta_ambiente_no_vuelve: "PUNTO_DE_VENTA_YA_EMITIO_EN_PRODUCCION", // lo lanza un disparador

  // serie_comprobante
  serie_pkey: "SERIE_YA_EXISTE",
  serie_comprobante_empresa_id_fkey: "EMPRESA_INEXISTENTE",
  serie_punto_de_venta_fkey: "PUNTO_DE_VENTA_NO_ENCONTRADO",
  serie_tipo_ck: "TIPO_DE_COMPROBANTE_INVALIDO",
  serie_ultimo_ck: "NUMERO_INVALIDO",
  serie_estado_ck: "NO_TRADUCIDA",
  serie_en_curso_ck: "NO_TRADUCIDA", // el dominio decide antes
  serie_bloqueo_ck: "NO_TRADUCIDA", // el dominio decide antes
  serie_inmutable: "SERIE_INMUTABLE", // lo lanza un disparador
  serie_numero_invalido: "SERIE_NUMERO_FUERA_DE_SECUENCIA", // lo lanza un disparador
  serie_transicion_invalida: "SERIE_TRANSICION_INVALIDA", // lo lanza un disparador
  // 0009: el ambiente es parte de la clave de la serie; una serie nace en el ambiente de su punto de venta.
  serie_ambiente_ck: "NO_TRADUCIDA",
  serie_ambiente_invalido: "SERIE_AMBIENTE_INVALIDO", // lo lanza un disparador

  // comprobante (0009): el contenido nace completo y no cambia; solo avanza el estado
  comprobante_pkey: "NO_TRADUCIDA", // el alta absorbe el conflicto del id (ON CONFLICT DO NOTHING)
  comprobante_empresa_id_fkey: "EMPRESA_INEXISTENTE",
  comprobante_creado_por_fkey: "PERSONA_INEXISTENTE",
  comprobante_ambiente_ck: "NO_TRADUCIDA", // los tipos del dominio (`AMBIENTES`) lo vuelven imposible
  comprobante_origen_tipo_ck: "NO_TRADUCIDA", // idem (`TIPOS_DE_ORIGEN`)
  comprobante_origen_id_ck: "ORIGEN_ID_INVALIDO",
  comprobante_clase_ck: "NO_TRADUCIDA",
  comprobante_tipo_ck: "TIPO_DE_COMPROBANTE_INVALIDO",
  comprobante_clase_tipo_ck: "NO_TRADUCIDA", // la clase la deriva el dominio del tipo
  comprobante_concepto_ck: "NO_TRADUCIDA",
  comprobante_servicio_ck: "FECHAS_DE_SERVICIO_INVALIDAS",
  comprobante_moneda_ck: "NO_TRADUCIDA", // hoy solo pesos (ADR-006): el dominio no deja elegir otra
  comprobante_modo_ck: "NO_TRADUCIDA",
  comprobante_modo_c_ck: "MODO_DE_PRECIO_INVALIDO_PARA_C",
  comprobante_importes_ck: "NO_TRADUCIDA", // el cálculo del dominio decide antes (TOTAL_FUERA_DE_RANGO)
  comprobante_c_sin_iva_ck: "NO_TRADUCIDA", // idem: la letra C no discrimina IVA
  comprobante_emisor_cuit_ck: "CUIT_INVALIDO",
  comprobante_emisor_razon_social_ck: "RAZON_SOCIAL_INVALIDA",
  comprobante_emisor_condicion_ck: "CONDICION_IVA_INVALIDA",
  comprobante_emisor_domicilio_ck: "NO_TRADUCIDA", // el domicilio ya lo validó la primitiva `Domicilio`
  comprobante_emisor_inicio_ck: "INICIO_DE_ACTIVIDADES_INVALIDO",
  comprobante_emisor_iibb_numero_ck: "IIBB_NUMERO_INVALIDO",
  comprobante_emisor_iibb_condicion_ck: "IIBB_CONDICION_INVALIDA",
  comprobante_pv_numero_ck: "PUNTO_DE_VENTA_NUMERO_INVALIDO",
  comprobante_pv_domicilio_ck: "NO_TRADUCIDA",
  comprobante_receptor_nombre_ck: "RECEPTOR_NOMBRE_INVALIDO",
  comprobante_receptor_doc_tipo_ck: "NO_TRADUCIDA",
  comprobante_receptor_condicion_ck: "NO_TRADUCIDA", // las once condiciones son un catálogo cerrado del dominio
  comprobante_receptor_domicilio_ck: "RECEPTOR_DOMICILIO_INVALIDO",
  comprobante_receptor_ck: "NO_TRADUCIDA", // el dominio (`validarReceptor`) decide antes
  comprobante_receptor_documento_ck: "RECEPTOR_DOCUMENTO_INVALIDO",
  comprobante_asociado_ck: "NO_TRADUCIDA", // factura sin asociado, nota con asociado: lo arma el dominio
  comprobante_motivo_ck: "MOTIVO_INVALIDO",
  comprobante_estado_ck: "NO_TRADUCIDA",
  comprobante_envios_ck: "NO_TRADUCIDA",
  comprobante_reserva_ck: "NO_TRADUCIDA", // la tabla de estados (§B.2.1): la imponen el dominio y el disparador
  comprobante_autorizado_ck: "NO_TRADUCIDA",
  comprobante_cae_vence_ck: "NO_TRADUCIDA",
  comprobante_descarte_ck: "MOTIVO_DE_DESCARTE_INVALIDO",
  comprobante_huella_ck: "NO_TRADUCIDA",
  comprobante_representacion_ck: "NO_TRADUCIDA",
  comprobante_id_empresa_uk: "NO_TRADUCIDA",
  comprobante_id_empresa_emisor_uk: "NO_TRADUCIDA",
  comprobante_emisor_fkey: "EMISOR_NO_ENCONTRADO",
  comprobante_pv_fkey: "PUNTO_DE_VENTA_NO_ENCONTRADO",
  comprobante_sucursal_fkey: "NO_TRADUCIDA", // la copia el disparador de alta del punto de venta, que ya apunta a una sucursal de la empresa
  comprobante_datos_fiscales_fkey: "DATOS_FISCALES_NO_ENCONTRADOS",
  comprobante_asociado_fkey: "COMPROBANTE_ASOCIADO_NO_ENCONTRADO",
  comprobante_identidad_uk: "COMPROBANTE_YA_EXISTE", // el alta del repositorio lo absorbe y devuelve el existente
  comprobante_manual_uk: "COMPROBANTE_YA_EXISTE", // idem: una clave manual nunca da dos comprobantes
  comprobante_numero_uk: "NUMERO_DUPLICADO",
  comprobante_en_vuelo_uk: "SERIE_OCUPADA",
  comprobante_alta_invalida: "COMPROBANTE_ALTA_INVALIDA", // lo lanza un disparador
  comprobante_asociado_invalido: "COMPROBANTE_ASOCIADO_INVALIDO", // lo lanza un disparador
  comprobante_inmutable: "COMPROBANTE_INMUTABLE", // lo lanza un disparador
  comprobante_sin_sucursal: "COMPROBANTE_ALTA_INVALIDA", // lo lanza un disparador (diferido): el alta siempre copia la del punto de venta
  comprobante_sucursal_cerrada: "SUCURSAL_CERRADA", // lo lanza un disparador (0017, D-50): el punto de venta es de una sucursal cerrada
  comprobante_transicion_invalida: "COMPROBANTE_TRANSICION_INVALIDA", // lo lanza un disparador
  comprobante_sin_reserva: "COMPROBANTE_SIN_RESERVA", // lo lanza un disparador (diferido)
  comprobante_serie_sin_reserva: "SERIE_CON_COMPROBANTE_EN_VUELO", // lo lanza un disparador (diferido)
  comprobante_descuadrado: "COMPROBANTE_DESCUADRADO", // lo lanza un disparador (diferido)

  // comprobante_linea (0009, solo inserción)
  comprobante_linea_pkey: "NO_TRADUCIDA",
  comprobante_linea_empresa_id_fkey: "EMPRESA_INEXISTENTE",
  comprobante_linea_comprobante_fkey: "COMPROBANTE_NO_ENCONTRADO",
  comprobante_linea_posicion_ck: "DEMASIADOS_RENGLONES",
  comprobante_linea_descripcion_ck: "RENGLON_DESCRIPCION_INVALIDA",
  comprobante_linea_cantidad_ck: "RENGLON_CANTIDAD_INVALIDA",
  comprobante_linea_precio_ck: "RENGLON_PRECIO_INVALIDO",
  comprobante_linea_descuento_ck: "NO_TRADUCIDA", // `Porcentaje` ya es de 0 a 100
  comprobante_linea_alicuota_ck: "NO_TRADUCIDA", // `CODIGOS_DE_ALICUOTA` es un catálogo cerrado
  comprobante_linea_importe_ck: "NO_TRADUCIDA",
  comprobante_linea_tardia: "COMPROBANTE_LINEA_TARDIA", // lo lanza un disparador

  // comprobante_alicuota (0009, solo inserción)
  comprobante_alicuota_pkey: "NO_TRADUCIDA",
  comprobante_alicuota_empresa_id_fkey: "EMPRESA_INEXISTENTE",
  comprobante_alicuota_comprobante_fkey: "COMPROBANTE_NO_ENCONTRADO",
  comprobante_alicuota_codigo_ck: "NO_TRADUCIDA",
  comprobante_alicuota_ck: "NO_TRADUCIDA",
  comprobante_alicuota_tardia: "COMPROBANTE_ALICUOTA_TARDIA", // lo lanza un disparador

  // certificado_arca (0009)
  certificado_arca_pkey: "NO_TRADUCIDA", // el alta absorbe el conflicto del id
  certificado_arca_empresa_id_fkey: "EMPRESA_INEXISTENTE",
  certificado_arca_creado_por_fkey: "PERSONA_INEXISTENTE",
  certificado_emisor_fkey: "EMISOR_NO_ENCONTRADO",
  certificado_id_empresa_uk: "NO_TRADUCIDA",
  certificado_ambiente_ck: "NO_TRADUCIDA",
  certificado_alias_ck: "ALIAS_INVALIDO",
  certificado_cuit_titular_ck: "CUIT_INVALIDO",
  certificado_estado_ck: "NO_TRADUCIDA",
  certificado_pedido_ck: "NO_TRADUCIDA", // el pedido lo genera Pedernal, no lo escribe una persona
  certificado_pem_ck: "CERTIFICADO_ILEGIBLE", // el texto que pega el gerente: vacío o desmesurado
  certificado_huella_ck: "NO_TRADUCIDA",
  certificado_clave_ck: "NO_TRADUCIDA",
  certificado_kid_ck: "NO_TRADUCIDA",
  certificado_cifrado_ck: "NO_TRADUCIDA",
  certificado_cargado_ck: "NO_TRADUCIDA", // el dominio de los certificados decide antes (cargado <=> con huella)
  certificado_vigente_uk: "CERTIFICADO_VIGENTE_YA_EXISTE", // el repositorio reemplaza al vigente antes de activar
  certificado_huella_uk: "CERTIFICADO_YA_CARGADO",
  certificado_transicion_invalida: "CERTIFICADO_TRANSICION_INVALIDA", // lo lanza un disparador
  certificado_inmutable: "CERTIFICADO_INMUTABLE", // lo lanza un disparador

  // acceso_arca (0009)
  acceso_arca_empresa_id_fkey: "EMPRESA_INEXISTENTE",
  acceso_servicio_ck: "NO_TRADUCIDA",
  acceso_pkey: "NO_TRADUCIDA", // el repositorio absorbe el conflicto (ON CONFLICT DO NOTHING)
  acceso_certificado_fkey: "CERTIFICADO_NO_ENCONTRADO",
  acceso_completo_ck: "NO_TRADUCIDA",

  // intento_arca (0009, solo inserción)
  intento_arca_pkey: "NO_TRADUCIDA",
  intento_arca_empresa_id_fkey: "EMPRESA_INEXISTENTE",
  intento_comprobante_fkey: "COMPROBANTE_NO_ENCONTRADO",
  intento_operacion_ck: "NO_TRADUCIDA",
  intento_numero_ck: "NO_TRADUCIDA",
  intento_desenlace_ck: "NO_TRADUCIDA",
  intento_operacion_desenlace_ck: "NO_TRADUCIDA",
  intento_mensajes_ck: "NO_TRADUCIDA",
  intento_respuesta_ck: "NO_TRADUCIDA", // lo sanea y acota el adaptador de ARCA
  intento_huella_ck: "NO_TRADUCIDA",
  intento_duracion_ck: "NO_TRADUCIDA",
} as const satisfies Readonly<Record<string, string>>;

/**
 * Los 37 nombres que lanzan los disparadores con `ERRCODE '23514'`: 21 de 0006 (spec H7 §B.10), 14 de 0009 y 2 de la sucursal del
 * comprobante (`comprobante_sin_sucursal` de 0016 y `comprobante_sucursal_cerrada` de 0017). Los de 0009: 3 sobre las tablas viejas
 * (`punto_de_venta_ambiente_con_serie_en_curso`, `punto_de_venta_ambiente_no_vuelve`, `serie_ambiente_invalido`) y 11 de la
 * facturación (comprobante, renglones, desglose y certificados).
 */
export const RESTRICCIONES_DE_DISPARADORES_DE_FISCAL = [
  "empresa_cuit_es_emisor",
  "empresa_cuit_inmutable",
  "emisor_inmutable",
  "emisor_empresa_no_operable",
  "emisor_cuit_es_empresa",
  "emisor_cuit_inmutable",
  "emisor_con_pv_activos",
  "punto_de_venta_inmutable",
  "punto_de_venta_numero_inmutable",
  "punto_de_venta_emisor_inactivo",
  "datos_fiscales_transicion_invalida",
  "datos_fiscales_inmutable",
  "datos_fiscales_confirmada_inmutable",
  "datos_fiscales_numero_invalido",
  "regla_emisor_transicion_invalida",
  "regla_emisor_inmutable",
  "regla_emisor_confirmada_inmutable",
  "regla_emisor_numero_invalido",
  "serie_inmutable",
  "serie_numero_invalido",
  "serie_transicion_invalida",
  "punto_de_venta_ambiente_con_serie_en_curso",
  "punto_de_venta_ambiente_no_vuelve",
  "serie_ambiente_invalido",
  "comprobante_alta_invalida",
  "comprobante_asociado_invalido",
  "comprobante_inmutable",
  "comprobante_sin_sucursal",
  "comprobante_sucursal_cerrada",
  "comprobante_transicion_invalida",
  "comprobante_sin_reserva",
  "comprobante_serie_sin_reserva",
  "comprobante_descuadrado",
  "comprobante_linea_tardia",
  "comprobante_alicuota_tardia",
  "certificado_transicion_invalida",
  "certificado_inmutable",
] as const satisfies readonly (keyof typeof ERRORES_DE_FISCAL_POR_RESTRICCION)[];

type Mapa = typeof ERRORES_DE_FISCAL_POR_RESTRICCION;

/** Todo error de negocio al que puede traducirse una restricción de las tablas fiscales. */
export type ErrorDeFiscalPorRestriccion = Exclude<Mapa[keyof Mapa], "NO_TRADUCIDA">;
