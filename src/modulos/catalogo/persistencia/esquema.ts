import type { Generated } from "kysely";

/**
 * Las tablas del catálogo (0025). Los decimales llegan como TEXTO (`numeric` de Postgres): nunca se pasan por `number` (ADR-006). Un test
 * compara estas columnas con el catálogo de la base (`catalogo-persistencia.test.ts`).
 */
export type CatalogoDb = {
  unidad_de_medida: {
    id: string;
    dimension: string;
    simbolo: string;
    factor_a_base: string;
    es_base: boolean;
  };
  seccion_de_carta: {
    /** El que manda la aplicación (idempotencia); si no lo manda, lo genera la base. */
    id: Generated<string>;
    empresa_id: string;
    nombre: string;
    nombre_clave: string;
    orden: number;
    activa: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  producto: {
    id: string;
    empresa_id: string;
    nombre: string;
    nombre_clave: string;
    nombre_de_cocina: string | null;
    descripcion_en_carta: string | null;
    codigo: string | null;
    codigo_de_barras: string | null;
    tipo: string;
    clase_de_uso: string;
    unidad_base_id: string;
    dimension: string;
    unidad_de_venta_id: string;
    paso_minimo: Generated<string>;
    alicuota_iva: string | null;
    falta_completar: Generated<boolean>;
    /** Columna generada: no se escribe. */
    se_vende: Generated<boolean>;
    seccion_de_carta_id: string | null;
    activo: Generated<boolean>;
    version_de_opciones: Generated<number>;
    creado_por: string | null;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  grupo_de_elecciones: {
    /** El que manda la aplicación (idempotencia); si no lo manda, lo genera la base. */
    id: Generated<string>;
    empresa_id: string;
    producto_id: string;
    clase: string;
    es_tamano: Generated<boolean>;
    nombre: string;
    nombre_clave: string;
    es_obligatorio: boolean;
    admite_varias: boolean;
    se_muestra_en_carta: Generated<boolean>;
    orden: number;
    activo: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  opcion: {
    /** El que manda la aplicación (idempotencia); si no lo manda, lo genera la base. */
    id: Generated<string>;
    empresa_id: string;
    producto_id: string;
    grupo_id: string;
    nombre_clave: string;
    orden: number;
    activa: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  version_de_opcion: {
    /** Lo genera la base (`gen_random_uuid()`): no hay un pedido que repetir. */
    id: Generated<string>;
    empresa_id: string;
    opcion_id: string;
    numero: number;
    nombre: string;
    recargo: Generated<string>;
    moneda: Generated<string>;
    iva_incluido: Generated<boolean>;
    factor_de_tamano: Generated<string>;
    cargada_por: string | null;
    creado_en: Date;
  };
  consumo_de_opcion: {
    empresa_id: string;
    version_de_opcion_id: string;
    numero: number;
    insumo_id: string;
    cantidad: string;
    escala_con_tamano: Generated<boolean>;
  };
  precio_de_venta: {
    /** El que manda la aplicación (idempotencia); si no lo manda, lo genera la base. */
    id: Generated<string>;
    empresa_id: string;
    producto_id: string;
    opcion_id: string | null;
    sucursal_id: string | null;
    precio: string | null;
    unidad_id: string;
    paso_minimo: string;
    moneda: Generated<string>;
    iva_incluido: Generated<boolean>;
    vigente_desde: Date;
    cargado_por: string | null;
    creado_en: Generated<Date>;
  };
  copia_de_opciones: {
    id: string;
    empresa_id: string;
    producto_origen_id: string;
    producto_destino_id: string;
    creado_por: string | null;
    creado_en: Generated<Date>;
  };
};

export const COLUMNAS_DE_CATALOGO = {
  unidad_de_medida: ["id", "dimension", "simbolo", "factor_a_base", "es_base"],
  seccion_de_carta: [
    "id",
    "empresa_id",
    "nombre",
    "nombre_clave",
    "orden",
    "activa",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  producto: [
    "id",
    "empresa_id",
    "nombre",
    "nombre_clave",
    "nombre_de_cocina",
    "descripcion_en_carta",
    "codigo",
    "codigo_de_barras",
    "tipo",
    "clase_de_uso",
    "unidad_base_id",
    "dimension",
    "unidad_de_venta_id",
    "paso_minimo",
    "alicuota_iva",
    "falta_completar",
    "se_vende",
    "seccion_de_carta_id",
    "activo",
    "version_de_opciones",
    "creado_por",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  grupo_de_elecciones: [
    "id",
    "empresa_id",
    "producto_id",
    "clase",
    "es_tamano",
    "nombre",
    "nombre_clave",
    "es_obligatorio",
    "admite_varias",
    "se_muestra_en_carta",
    "orden",
    "activo",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  opcion: [
    "id",
    "empresa_id",
    "producto_id",
    "grupo_id",
    "nombre_clave",
    "orden",
    "activa",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  version_de_opcion: [
    "id",
    "empresa_id",
    "opcion_id",
    "numero",
    "nombre",
    "recargo",
    "moneda",
    "iva_incluido",
    "factor_de_tamano",
    "cargada_por",
    "creado_en",
  ],
  consumo_de_opcion: [
    "empresa_id",
    "version_de_opcion_id",
    "numero",
    "insumo_id",
    "cantidad",
    "escala_con_tamano",
  ],
  precio_de_venta: [
    "id",
    "empresa_id",
    "producto_id",
    "opcion_id",
    "sucursal_id",
    "precio",
    "unidad_id",
    "paso_minimo",
    "moneda",
    "iva_incluido",
    "vigente_desde",
    "cargado_por",
    "creado_en",
  ],
  copia_de_opciones: [
    "id",
    "empresa_id",
    "producto_origen_id",
    "producto_destino_id",
    "creado_por",
    "creado_en",
  ],
} as const;

/**
 * Restricción de la base → error de negocio (ADR-004). Un test exige que no falte ninguna ni sobre una que no existe. `NO_TRADUCIDA`: una
 * restricción que ningún caso de uso puede provocar por una razón de negocio (clave, apoyo de una clave foránea): sale como error de
 * persistencia tipado, nunca disfrazada.
 */
export const ERRORES_DE_CATALOGO_POR_RESTRICCION: Readonly<Record<string, string>> = {
  // unidad_de_medida (sembrada: nadie la escribe)
  unidad_de_medida_pkey: "NO_TRADUCIDA",
  unidad_id_ck: "NO_TRADUCIDA",
  unidad_dimension_ck: "NO_TRADUCIDA",
  unidad_simbolo_ck: "NO_TRADUCIDA",
  unidad_factor_ck: "NO_TRADUCIDA",
  unidad_base_ck: "NO_TRADUCIDA",
  unidad_simbolo_uk: "NO_TRADUCIDA",
  unidad_id_dimension_uk: "NO_TRADUCIDA",
  unidad_una_base_uk: "NO_TRADUCIDA",
  // seccion_de_carta
  seccion_de_carta_pkey: "NO_TRADUCIDA",
  seccion_de_carta_empresa_id_fkey: "NO_TRADUCIDA",
  seccion_de_carta_id_empresa_uk: "NO_TRADUCIDA",
  seccion_de_carta_nombre_ck: "NOMBRE_DE_SECCION_INVALIDO",
  seccion_de_carta_nombre_clave_ck: "NOMBRE_DE_SECCION_INVALIDO",
  seccion_de_carta_orden_ck: "ORDEN_INVALIDO",
  seccion_de_carta_nombre_uk: "SECCION_DUPLICADA",
  // producto
  producto_pkey: "ID_REUTILIZADO",
  producto_empresa_id_fkey: "NO_TRADUCIDA",
  producto_creado_por_fkey: "NO_TRADUCIDA",
  producto_id_empresa_uk: "NO_TRADUCIDA",
  // 0030 (stock): destinos de las claves foráneas del artículo y de los componentes; siempre únicas (incluyen `id`), nadie las dispara
  producto_id_unidad_base_empresa_uk: "NO_TRADUCIDA",
  producto_id_dimension_empresa_uk: "NO_TRADUCIDA",
  producto_nombre_ck: "NOMBRE_DE_PRODUCTO_INVALIDO",
  producto_nombre_clave_ck: "NOMBRE_DE_PRODUCTO_INVALIDO",
  producto_nombre_de_cocina_ck: "NOMBRE_DE_COCINA_INVALIDO",
  producto_descripcion_ck: "DESCRIPCION_INVALIDA",
  producto_codigo_ck: "CODIGO_INVALIDO",
  producto_codigo_de_barras_ck: "CODIGO_DE_BARRAS_INVALIDO",
  producto_tipo_ck: "NO_TRADUCIDA",
  producto_clase_de_uso_ck: "CLASE_INVALIDA",
  producto_paso_ck: "FORMA_DE_VENTA_INVALIDA",
  producto_paso_cota_ck: "FORMA_DE_VENTA_INVALIDA",
  producto_paso_no_exacto: "FORMA_DE_VENTA_INVALIDA",
  producto_alicuota_ck: "ALICUOTA_INVALIDA",
  producto_unidad_fkey: "UNIDAD_INVALIDA",
  producto_unidad_de_venta_fkey: "UNIDAD_INVALIDA",
  producto_seccion_fkey: "SECCION_NO_ENCONTRADA",
  producto_clase_sin_venta_ck: "CAMPO_NO_ADMITIDO_POR_LA_CLASE",
  producto_forma_de_venta_sin_venta_ck: "FORMA_DE_VENTA_INVALIDA",
  producto_nombre_uk: "PRODUCTO_DUPLICADO",
  producto_codigo_uk: "CODIGO_DUPLICADO",
  producto_codigo_de_barras_uk: "CODIGO_DE_BARRAS_DUPLICADO",
  producto_clase_de_uso_inmutable: "NO_TRADUCIDA",
  producto_unidad_inmutable: "NO_TRADUCIDA",
  producto_identidad_inmutable: "NO_TRADUCIDA",
  // grupo_de_elecciones
  grupo_de_elecciones_pkey: "ID_REUTILIZADO",
  grupo_de_elecciones_empresa_id_fkey: "NO_TRADUCIDA",
  grupo_de_elecciones_id_empresa_uk: "NO_TRADUCIDA",
  grupo_de_elecciones_id_producto_uk: "NO_TRADUCIDA",
  grupo_de_elecciones_producto_fkey: "PRODUCTO_NO_ENCONTRADO",
  grupo_de_elecciones_clase_ck: "CLASE_DE_GRUPO_INVALIDA",
  grupo_de_elecciones_nombre_ck: "NOMBRE_DE_GRUPO_INVALIDO",
  grupo_de_elecciones_nombre_clave_ck: "NOMBRE_DE_GRUPO_INVALIDO",
  grupo_de_elecciones_orden_ck: "ORDEN_INVALIDO",
  grupo_de_elecciones_tamano_ck: "TAMANO_SOLO_EN_VARIANTE",
  grupo_de_elecciones_variante_ck: "NO_TRADUCIDA",
  grupo_de_elecciones_nombre_uk: "GRUPO_DUPLICADO",
  grupo_de_elecciones_variante_uk: "SEGUNDA_VARIANTE",
  grupo_de_elecciones_inmutable: "NO_TRADUCIDA",
  grupo_de_producto_no_vendible: "PRODUCTO_NO_VENDIBLE",
  // opcion
  opcion_pkey: "ID_REUTILIZADO",
  opcion_empresa_id_fkey: "NO_TRADUCIDA",
  opcion_id_empresa_uk: "NO_TRADUCIDA",
  opcion_id_producto_uk: "NO_TRADUCIDA",
  opcion_nombre_clave_ck: "NOMBRE_DE_OPCION_INVALIDO",
  opcion_orden_ck: "ORDEN_INVALIDO",
  opcion_nombre_uk: "OPCION_DUPLICADA",
  opcion_grupo_fkey: "OPCION_INVALIDA",
  opcion_inmutable: "NO_TRADUCIDA",
  // version_de_opcion
  version_de_opcion_pkey: "NO_TRADUCIDA",
  version_de_opcion_empresa_id_fkey: "NO_TRADUCIDA",
  version_de_opcion_cargada_por_fkey: "NO_TRADUCIDA",
  version_de_opcion_id_empresa_uk: "NO_TRADUCIDA",
  version_de_opcion_numero_ck: "NO_TRADUCIDA",
  version_de_opcion_nombre_ck: "NOMBRE_DE_OPCION_INVALIDO",
  version_de_opcion_recargo_ck: "RECARGO_INVALIDO",
  version_de_opcion_moneda_ck: "NO_TRADUCIDA",
  version_de_opcion_iva_incluido_ck: "NO_TRADUCIDA",
  version_de_opcion_factor_ck: "FACTOR_DE_TAMANO_INVALIDO",
  version_de_opcion_opcion_fkey: "OPCION_INVALIDA",
  version_de_opcion_numero_uk: "OPCIONES_DESACTUALIZADAS",
  version_de_opcion_incluida_con_recargo: "INCLUIDA_CON_RECARGO",
  version_de_opcion_eleccion_oculta_con_precio: "ELECCION_OCULTA_CON_PRECIO",
  version_de_opcion_factor_sin_tamano: "FACTOR_DE_TAMANO_INVALIDO",
  version_de_opcion_numero_salteado: "OPCIONES_DESACTUALIZADAS",
  // consumo_de_opcion
  consumo_de_opcion_pkey: "NO_TRADUCIDA",
  consumo_de_opcion_empresa_id_fkey: "NO_TRADUCIDA",
  consumo_de_opcion_numero_ck: "NO_TRADUCIDA",
  consumo_de_opcion_cantidad_ck: "CANTIDAD_INVALIDA",
  consumo_de_opcion_insumo_uk: "CONSUMO_REPETIDO",
  consumo_de_opcion_version_fkey: "OPCION_INVALIDA",
  consumo_de_opcion_insumo_fkey: "INSUMO_NO_ENCONTRADO",
  consumo_de_opcion_de_variante: "GRUPO_DE_VARIANTE_SIN_CONSUMO",
  consumo_de_opcion_version_confirmada: "NO_TRADUCIDA",
  consumo_de_opcion_insumo_es_el_mismo_producto: "INSUMO_ES_EL_MISMO_PRODUCTO",
  consumo_de_opcion_insumo_no_admitido: "INSUMO_NO_ADMITIDO",
  // precio_de_venta
  precio_de_venta_pkey: "ID_REUTILIZADO",
  precio_de_venta_empresa_id_fkey: "NO_TRADUCIDA",
  precio_de_venta_unidad_id_fkey: "NO_TRADUCIDA",
  precio_de_venta_cargado_por_fkey: "NO_TRADUCIDA",
  precio_de_venta_id_empresa_uk: "NO_TRADUCIDA",
  precio_de_venta_precio_ck: "PRECIO_INVALIDO",
  precio_de_venta_paso_ck: "NO_TRADUCIDA",
  precio_de_venta_moneda_ck: "NO_TRADUCIDA",
  precio_de_venta_iva_incluido_ck: "NO_TRADUCIDA",
  precio_de_venta_producto_fkey: "PRODUCTO_NO_ENCONTRADO",
  precio_de_venta_opcion_fkey: "OPCION_INVALIDA",
  precio_de_venta_sucursal_fkey: "SUCURSAL_NO_ENCONTRADA",
  precio_de_venta_vigencia_uk: "PRECIO_DESACTUALIZADO",
  precio_de_venta_producto_no_vendible: "PRODUCTO_NO_VENDIBLE",
  precio_forma_de_venta_distinta: "PRECIO_EN_OTRA_FORMA_DE_VENTA",
  precio_propio_con_variante: "PRECIO_DE_PRODUCTO_CON_VARIANTE",
  precio_de_venta_grupo_inactivo: "OPCION_INVALIDA",
  precio_incluida_con_recargo: "INCLUIDA_CON_RECARGO",
  precio_recargo_de_empresa_en_precio: "RECARGO_DE_EMPRESA_SE_EDITA_EN_OPCIONES",
  precio_eleccion_oculta_con_precio: "ELECCION_OCULTA_CON_PRECIO",
  precio_fuera_de_orden: "PRECIO_DESACTUALIZADO",
  // copia_de_opciones
  copia_de_opciones_pkey: "ID_REUTILIZADO",
  copia_de_opciones_empresa_id_fkey: "NO_TRADUCIDA",
  copia_de_opciones_creado_por_fkey: "NO_TRADUCIDA",
  copia_de_opciones_distintos_ck: "COPIA_A_SI_MISMO",
  copia_de_opciones_origen_fkey: "PRODUCTO_NO_ENCONTRADO",
  copia_de_opciones_destino_fkey: "PRODUCTO_NO_ENCONTRADO",
};
