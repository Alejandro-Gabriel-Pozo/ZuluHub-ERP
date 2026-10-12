/**
 * Esquema de base del módulo fiscal (migración `0006_fiscal.sql`). Lo comparan las pruebas de
 * integración contra la base real: si una columna o una restricción cambia en el SQL, estas listas
 * tienen que cambiar con ella. No hay tabla de comprobantes ni de certificados: son de la
 * facturación (spec H7 §A.2 y §B.9).
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
  ],
} as const;

/**
 * Restricción de la base → error de negocio (ADR-004). Un test exige que no falte ninguna y que no
 * sobre ninguna. `NO_TRADUCIDA`: no tiene un error de negocio propio (el dominio decide antes; si
 * salta, es un defecto). Los nombres que coinciden con un error del dominio fiscal (por ejemplo
 * `PUNTO_DE_VENTA_DUPLICADO`) son ese mismo error: el caso de uso lo declara una sola vez.
 *
 * Los 21 nombres que lanzan los disparadores (`CONSTRAINT = '...'` en 0006) están al final de cada
 * tabla, marcados «lo lanza un disparador», y NINGUNO es `NO_TRADUCIDA`. Dos de ellos viven en
 * `empresa` (`empresa_cuit_es_emisor`, `empresa_cuit_inmutable`): los lanza el alta o la corrección
 * del CUIT de una empresa y el caso de uso de plataforma que los hace los traduce con este mapa.
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
} as const satisfies Readonly<Record<string, string>>;

/** Los 21 nombres que lanzan los disparadores de 0006 con `ERRCODE '23514'` (spec H7 §B.10). */
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
] as const satisfies readonly (keyof typeof ERRORES_DE_FISCAL_POR_RESTRICCION)[];

type Mapa = typeof ERRORES_DE_FISCAL_POR_RESTRICCION;

/** Todo error de negocio al que puede traducirse una restricción de las tablas fiscales. */
export type ErrorDeFiscalPorRestriccion = Exclude<Mapa[keyof Mapa], "NO_TRADUCIDA">;
