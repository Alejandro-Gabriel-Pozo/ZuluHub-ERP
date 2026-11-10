import type { Generated } from "kysely";
import type { EstadoDeCuenta, EstadoDeLinea, EstadoDeTicket } from "../dominio/estados";

/**
 * Las tablas de ventas (0028). Los decimales llegan como TEXTO (`numeric` de Postgres): nunca se pasan por `number` (ADR-006). `fecha_negocio`
 * es un `date`: el controlador lo entregaría como un `Date` a medianoche local (con el corrimiento de un día que eso trae), así que se LEE
 * siempre como texto (`::text`, `YYYY-MM-DD`). Un test compara estas columnas con el catálogo de la base (`ventas-persistencia.test.ts`).
 */
export type VentasDb = {
  aplicacion_de_cobro: {
    empresa_id: string;
    cobranza_id: string;
    orden: number;
    cobro_id: string;
    cuenta_de_cobro_id: string | null;
    importe: string;
    creado_en: Generated<Date>;
  };
  cobranza_de_ticket: {
    id: string;
    empresa_id: string;
    ticket_id: string;
    ejemplar_id: string;
    caja_id: string;
    clave: string;
    huella: string;
    destino: Generated<string>;
    resultado: Readonly<Record<string, unknown>> | null;
    creada_por: string;
    creada_en: Date;
    creado_en: Generated<Date>;
  };
  cuenta_consumo: {
    id: string;
    empresa_id: string;
    sucursal_id: string;
    ancla_tipo: string | null;
    ancla_id: string | null;
    etiqueta: string | null;
    estado: Generated<EstadoDeCuenta>;
    moneda: Generated<string>;
    total_provisorio: Generated<string>;
    ultima_posicion: Generated<number>;
    momento_de_stock: Generated<string>;
    abierta_por: string;
    abierta_en: Date;
    resuelta_por: string | null;
    resuelta_en: Date | null;
    motivo: string | null;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  ejemplar_grupo: {
    empresa_id: string;
    ejemplar_id: string;
    orden: number;
    total: string;
    emisor_id: string | null;
  };
  ejemplar_linea: {
    empresa_id: string;
    ejemplar_id: string;
    grupo_orden: number;
    linea_cuenta_id: string;
    cantidad: string;
    importe: string;
  };
  linea_cuenta: {
    id: string;
    empresa_id: string;
    cuenta_id: string;
    posicion: number;
    producto_id: string;
    descripcion: string;
    variante_opcion_id: string | null;
    variante_nombre: string | null;
    precio_id: string;
    origen_del_precio: string;
    moneda: Generated<string>;
    precio_base: string;
    precio_unitario: string;
    cantidad: string;
    unidad_de_venta: string;
    paso_de_cantidad: string;
    alicuota: string;
    controla_stock: Generated<boolean>;
    estado: Generated<EstadoDeLinea>;
    anulada_por: string | null;
    anulada_en: Date | null;
    motivo_de_anulacion: string | null;
    creada_por: string;
    creada_en: Date;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  linea_cuenta_opcion: {
    empresa_id: string;
    linea_id: string;
    orden: number;
    opcion_id: string;
    version_de_opcion_id: string;
    grupo_id: string;
    nombre_de_grupo: string;
    nombre: string;
    clase: string;
    recargo: string;
    origen_del_recargo: string;
    creado_en: Generated<Date>;
  };
  numerador_ticket: {
    empresa_id: string;
    sucursal_id: string;
    ultimo: Generated<number>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  ticket: {
    id: Generated<string>;
    empresa_id: string;
    sucursal_id: string;
    cuenta_id: string;
    numero: number;
    fecha_negocio: Generated<string>;
    estado: EstadoDeTicket;
    moneda: Generated<string>;
    total: string;
    sesion_de_caja_id: string | null;
    ejemplar_vigente: Generated<number>;
    emitido_por: string;
    emitido_en: Date;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  ticket_correccion: {
    id: string;
    empresa_id: string;
    ticket_id: string;
    ejemplar_base_id: string;
    ejemplar_nuevo_id: string;
    tipo: string;
    motivo: string;
    clave: string;
    huella: string;
    resultado: Readonly<Record<string, unknown>>;
    hecha_por: string;
    hecha_en: Date;
    fecha_negocio: Generated<string>;
    creado_en: Generated<Date>;
  };
  ticket_ejemplar: {
    id: string;
    empresa_id: string;
    ticket_id: string;
    numero_de_ejemplar: number;
    tipo: string;
    total: string;
    ejemplar_base_id: string | null;
    creado_por: string;
    creado_en: Date;
  };
};

/** Tablas y columnas del módulo, en el orden de la base; un test las compara con el catálogo. */
export const COLUMNAS_DE_VENTAS = {
  aplicacion_de_cobro: [
    "empresa_id",
    "cobranza_id",
    "orden",
    "cobro_id",
    "cuenta_de_cobro_id",
    "importe",
    "creado_en",
  ],
  cobranza_de_ticket: [
    "id",
    "empresa_id",
    "ticket_id",
    "ejemplar_id",
    "caja_id",
    "clave",
    "huella",
    "destino",
    "resultado",
    "creada_por",
    "creada_en",
    "creado_en",
  ],
  cuenta_consumo: [
    "id",
    "empresa_id",
    "sucursal_id",
    "ancla_tipo",
    "ancla_id",
    "etiqueta",
    "estado",
    "moneda",
    "total_provisorio",
    "ultima_posicion",
    "momento_de_stock",
    "abierta_por",
    "abierta_en",
    "resuelta_por",
    "resuelta_en",
    "motivo",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  ejemplar_grupo: ["empresa_id", "ejemplar_id", "orden", "total", "emisor_id"],
  ejemplar_linea: [
    "empresa_id",
    "ejemplar_id",
    "grupo_orden",
    "linea_cuenta_id",
    "cantidad",
    "importe",
  ],
  linea_cuenta: [
    "id",
    "empresa_id",
    "cuenta_id",
    "posicion",
    "producto_id",
    "descripcion",
    "variante_opcion_id",
    "variante_nombre",
    "precio_id",
    "origen_del_precio",
    "moneda",
    "precio_base",
    "precio_unitario",
    "cantidad",
    "unidad_de_venta",
    "paso_de_cantidad",
    "alicuota",
    "controla_stock",
    "estado",
    "anulada_por",
    "anulada_en",
    "motivo_de_anulacion",
    "creada_por",
    "creada_en",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  linea_cuenta_opcion: [
    "empresa_id",
    "linea_id",
    "orden",
    "opcion_id",
    "version_de_opcion_id",
    "grupo_id",
    "nombre_de_grupo",
    "nombre",
    "clase",
    "recargo",
    "origen_del_recargo",
    "creado_en",
  ],
  numerador_ticket: [
    "empresa_id",
    "sucursal_id",
    "ultimo",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  ticket: [
    "id",
    "empresa_id",
    "sucursal_id",
    "cuenta_id",
    "numero",
    "fecha_negocio",
    "estado",
    "moneda",
    "total",
    "sesion_de_caja_id",
    "ejemplar_vigente",
    "emitido_por",
    "emitido_en",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  ticket_correccion: [
    "id",
    "empresa_id",
    "ticket_id",
    "ejemplar_base_id",
    "ejemplar_nuevo_id",
    "tipo",
    "motivo",
    "clave",
    "huella",
    "resultado",
    "hecha_por",
    "hecha_en",
    "fecha_negocio",
    "creado_en",
  ],
  ticket_ejemplar: [
    "id",
    "empresa_id",
    "ticket_id",
    "numero_de_ejemplar",
    "tipo",
    "total",
    "ejemplar_base_id",
    "creado_por",
    "creado_en",
  ],
} as const;

/**
 * Restricción de la base → error de negocio (ADR-004). Un test exige que no falte ninguna (ni las que lanzan los disparadores) y que no
 * sobre ninguna. `NO_TRADUCIDA`: una restricción que ningún caso de uso debería provocar si valida antes; si llega, sale como el error de
 * persistencia tipado que ya es (nunca se traga ni se disfraza). `INVARIANTE_DE_VENTAS`: la red de seguridad de la base saltó (un cuadre
 * de importes o de números): es un defecto del código, no un error del usuario.
 */
export const ERRORES_DE_VENTAS_POR_RESTRICCION: Readonly<Record<string, string>> = {
  aplicacion_cobranza_fkey: "NO_TRADUCIDA",
  aplicacion_cobro_uk: "NO_TRADUCIDA",
  aplicacion_de_cobro_empresa_id_fkey: "NO_TRADUCIDA",
  aplicacion_de_cobro_pkey: "NO_TRADUCIDA",
  aplicacion_importe_ck: "NO_TRADUCIDA",
  aplicacion_orden_ck: "NO_TRADUCIDA",
  aplicacion_solo_con_la_cobranza: "NO_TRADUCIDA",
  cobranza_clave_ck: "NO_TRADUCIDA",
  cobranza_clave_uk: "CLAVE_REUTILIZADA",
  cobranza_cuadra: "INVARIANTE_DE_VENTAS",
  cobranza_cuadra_de_la_aplicacion: "NO_TRADUCIDA",
  cobranza_cuadra_de_la_cobranza: "NO_TRADUCIDA",
  cobranza_de_ticket_creada_por_fkey: "NO_TRADUCIDA",
  cobranza_de_ticket_empresa_id_fkey: "NO_TRADUCIDA",
  cobranza_de_ticket_pkey: "NO_TRADUCIDA",
  cobranza_destino_ck: "NO_TRADUCIDA",
  cobranza_ejemplar_fkey: "NO_TRADUCIDA",
  cobranza_huella_ck: "NO_TRADUCIDA",
  cobranza_id_empresa_uk: "NO_TRADUCIDA",
  cobranza_inmutable: "NO_TRADUCIDA",
  cobranza_resultado_ck: "NO_TRADUCIDA",
  cobranza_ticket_fkey: "NO_TRADUCIDA",
  cobranza_ticket_no_cobrable: "NO_TRADUCIDA",
  cobranza_ticket_uk: "TICKET_YA_COBRADO",
  correccion_base_fkey: "NO_TRADUCIDA",
  correccion_clave_ck: "NO_TRADUCIDA",
  correccion_clave_uk: "CLAVE_REUTILIZADA",
  correccion_ejemplar_uk: "NO_TRADUCIDA",
  correccion_ejemplares_invalidos: "NO_TRADUCIDA",
  correccion_fecha_ck: "NO_TRADUCIDA",
  correccion_fecha_invalida: "NO_TRADUCIDA",
  correccion_huella_ck: "NO_TRADUCIDA",
  correccion_id_empresa_uk: "NO_TRADUCIDA",
  correccion_motivo_ck: "MOTIVO_INVALIDO",
  correccion_nuevo_fkey: "NO_TRADUCIDA",
  correccion_resultado_ck: "NO_TRADUCIDA",
  correccion_ticket_fkey: "NO_TRADUCIDA",
  correccion_tipo_ck: "NO_TRADUCIDA",
  cuenta_alta_invalida: "NO_TRADUCIDA",
  cuenta_ancla_abierta_uk: "ANCLA_OCUPADA",
  cuenta_ancla_completa_ck: "NO_TRADUCIDA",
  cuenta_ancla_tipo_ck: "ANCLA_INVALIDA",
  cuenta_consumo_abierta_por_fkey: "NO_TRADUCIDA",
  cuenta_consumo_empresa_id_fkey: "NO_TRADUCIDA",
  cuenta_consumo_pkey: "NO_TRADUCIDA",
  cuenta_consumo_resuelta_por_fkey: "NO_TRADUCIDA",
  cuenta_estado_ck: "NO_TRADUCIDA",
  cuenta_etiqueta_ck: "ETIQUETA_INVALIDA",
  cuenta_id_empresa_uk: "NO_TRADUCIDA",
  cuenta_inmutable: "NO_TRADUCIDA",
  cuenta_momento_de_stock_ck: "NO_TRADUCIDA",
  cuenta_moneda_ck: "NO_TRADUCIDA",
  cuenta_motivo_ck: "MOTIVO_INVALIDO",
  cuenta_persona_del_contexto: "NO_TRADUCIDA",
  cuenta_posicion_invalida: "NO_TRADUCIDA",
  cuenta_resuelta_ck: "NO_TRADUCIDA",
  cuenta_resuelta_congelada: "CUENTA_NO_ABIERTA",
  cuenta_sucursal_fkey: "SUCURSAL_NO_ENCONTRADA",
  cuenta_total_ck: "NO_TRADUCIDA",
  cuenta_total_cuadra: "INVARIANTE_DE_VENTAS",
  cuenta_total_de_la_cuenta: "NO_TRADUCIDA",
  cuenta_total_de_la_linea: "NO_TRADUCIDA",
  cuenta_transicion_invalida: "NO_TRADUCIDA",
  cuenta_ultima_posicion_ck: "NO_TRADUCIDA",
  ejemplar_anulacion_ck: "NO_TRADUCIDA",
  ejemplar_anulacion_invalida: "NO_TRADUCIDA",
  ejemplar_base_fkey: "NO_TRADUCIDA",
  ejemplar_base_invalida: "NO_TRADUCIDA",
  ejemplar_contenido_solo_con_el_ejemplar: "NO_TRADUCIDA",
  ejemplar_cuadra: "INVARIANTE_DE_VENTAS",
  ejemplar_cuadra_del_ejemplar: "NO_TRADUCIDA",
  ejemplar_cuadra_del_grupo: "NO_TRADUCIDA",
  ejemplar_cuadra_del_renglon: "NO_TRADUCIDA",
  ejemplar_grupo_empresa_id_fkey: "NO_TRADUCIDA",
  ejemplar_grupo_pkey: "NO_TRADUCIDA",
  ejemplar_id_empresa_uk: "NO_TRADUCIDA",
  ejemplar_linea_ajena: "INVARIANTE_DE_VENTAS",
  ejemplar_linea_cantidad_ck: "NO_TRADUCIDA",
  ejemplar_linea_ejemplar_fkey: "NO_TRADUCIDA",
  ejemplar_linea_empresa_id_fkey: "NO_TRADUCIDA",
  ejemplar_linea_grupo_fkey: "NO_TRADUCIDA",
  ejemplar_linea_importe_ck: "NO_TRADUCIDA",
  ejemplar_linea_linea_fkey: "NO_TRADUCIDA",
  ejemplar_linea_pkey: "NO_TRADUCIDA",
  ejemplar_no_es_el_vigente: "INVARIANTE_DE_VENTAS",
  ejemplar_numero_ck: "NO_TRADUCIDA",
  ejemplar_numero_uk: "NO_TRADUCIDA",
  ejemplar_original_ck: "NO_TRADUCIDA",
  ejemplar_original_no_refleja_la_cuenta: "INVARIANTE_DE_VENTAS",
  ejemplar_ticket_fkey: "NO_TRADUCIDA",
  ejemplar_ticket_invalido: "NO_TRADUCIDA",
  ejemplar_tipo_ck: "NO_TRADUCIDA",
  ejemplar_total_ck: "NO_TRADUCIDA",
  grupo_ejemplar_fkey: "NO_TRADUCIDA",
  grupo_orden_ck: "NO_TRADUCIDA",
  grupo_total_ck: "NO_TRADUCIDA",
  linea_alicuota_ck: "NO_TRADUCIDA",
  linea_alta_invalida: "NO_TRADUCIDA",
  linea_anulada_ck: "NO_TRADUCIDA",
  linea_anulada_congelada: "NO_TRADUCIDA",
  linea_cantidad_ck: "CANTIDAD_INVALIDA",
  linea_cantidad_multiplo_ck: "CANTIDAD_INVALIDA",
  linea_cuenta_anulada_por_fkey: "NO_TRADUCIDA",
  linea_cuenta_creada_por_fkey: "NO_TRADUCIDA",
  linea_cuenta_empresa_id_fkey: "NO_TRADUCIDA",
  linea_cuenta_fkey: "NO_TRADUCIDA",
  linea_cuenta_no_abierta: "CUENTA_NO_ABIERTA",
  linea_cuenta_opcion_empresa_id_fkey: "NO_TRADUCIDA",
  linea_cuenta_pkey: "NO_TRADUCIDA",
  linea_descripcion_ck: "NO_TRADUCIDA",
  linea_estado_ck: "NO_TRADUCIDA",
  linea_id_empresa_uk: "NO_TRADUCIDA",
  linea_inmutable: "NO_TRADUCIDA",
  linea_moneda_ck: "NO_TRADUCIDA",
  linea_motivo_ck: "MOTIVO_INVALIDO",
  linea_opcion_clase_ck: "NO_TRADUCIDA",
  linea_opcion_grupo_ck: "NO_TRADUCIDA",
  linea_opcion_linea_fkey: "NO_TRADUCIDA",
  linea_opcion_nombre_ck: "NO_TRADUCIDA",
  linea_opcion_opcion_uk: "NO_TRADUCIDA",
  linea_opcion_orden_ck: "NO_TRADUCIDA",
  linea_opcion_origen_ck: "NO_TRADUCIDA",
  linea_opcion_pkey: "NO_TRADUCIDA",
  linea_opcion_recargo_ck: "NO_TRADUCIDA",
  linea_opcion_solo_con_la_linea: "NO_TRADUCIDA",
  linea_origen_del_precio_ck: "NO_TRADUCIDA",
  linea_paso_ck: "CANTIDAD_INVALIDA",
  linea_persona_del_contexto: "NO_TRADUCIDA",
  linea_posicion_ck: "NO_TRADUCIDA",
  linea_posicion_no_reservada: "NO_TRADUCIDA",
  linea_posicion_uk: "NO_TRADUCIDA",
  linea_precio_base_ck: "NO_TRADUCIDA",
  linea_precio_cuadra: "INVARIANTE_DE_VENTAS",
  linea_precio_de_la_linea: "NO_TRADUCIDA",
  linea_precio_unitario_ck: "NO_TRADUCIDA",
  linea_precio_unitario_minimo_ck: "NO_TRADUCIDA",
  linea_unidad_de_venta_ck: "NO_TRADUCIDA",
  linea_variante_completa_ck: "NO_TRADUCIDA",
  linea_variante_nombre_ck: "NO_TRADUCIDA",
  numerador_alta_invalida: "NO_TRADUCIDA",
  numerador_inmutable: "NO_TRADUCIDA",
  numerador_sin_huecos: "INVARIANTE_DE_VENTAS",
  numerador_sin_huecos_ck: "NO_TRADUCIDA",
  numerador_solo_sube_de_a_uno: "NO_TRADUCIDA",
  numerador_sucursal_fkey: "NO_TRADUCIDA",
  numerador_ticket_empresa_id_fkey: "NO_TRADUCIDA",
  numerador_ticket_pkey: "NO_TRADUCIDA",
  numerador_ultimo_ck: "NO_TRADUCIDA",
  ticket_alta_invalida: "NO_TRADUCIDA",
  ticket_cobrado_sin_cobranza: "INVARIANTE_DE_VENTAS",
  ticket_correccion_empresa_id_fkey: "NO_TRADUCIDA",
  ticket_correccion_hecha_por_fkey: "NO_TRADUCIDA",
  ticket_correccion_pkey: "NO_TRADUCIDA",
  ticket_cortesia_ck: "NO_TRADUCIDA",
  ticket_cuenta_fkey: "NO_TRADUCIDA",
  ticket_cuenta_invalida: "INVARIANTE_DE_VENTAS",
  ticket_cuenta_uk: "NO_TRADUCIDA",
  ticket_ejemplar_creado_por_fkey: "NO_TRADUCIDA",
  ticket_ejemplar_empresa_id_fkey: "NO_TRADUCIDA",
  ticket_ejemplar_pkey: "NO_TRADUCIDA",
  ticket_ejemplar_vigente_ck: "NO_TRADUCIDA",
  ticket_ejemplar_vigente_existe: "INVARIANTE_DE_VENTAS",
  ticket_ejemplar_vigente_salto: "NO_TRADUCIDA",
  ticket_emitido_por_fkey: "NO_TRADUCIDA",
  ticket_empresa_id_fkey: "NO_TRADUCIDA",
  ticket_estado_ck: "NO_TRADUCIDA",
  ticket_fecha_ck: "NO_TRADUCIDA",
  ticket_fecha_de_negocio_invalida: "INVARIANTE_DE_VENTAS",
  ticket_fecha_de_sesion_invalida: "INVARIANTE_DE_VENTAS",
  ticket_id_empresa_uk: "NO_TRADUCIDA",
  ticket_inmutable: "NO_TRADUCIDA",
  ticket_moneda_ck: "NO_TRADUCIDA",
  ticket_numero_ck: "NO_TRADUCIDA",
  ticket_numero_invalido: "INVARIANTE_DE_VENTAS",
  ticket_numero_uk: "NO_TRADUCIDA",
  ticket_pkey: "NO_TRADUCIDA",
  ticket_sucursal_fkey: "NO_TRADUCIDA",
  ticket_total_ck: "NO_TRADUCIDA",
  ticket_transicion_invalida: "NO_TRADUCIDA",
  ticket_vigente_del_ejemplar: "NO_TRADUCIDA",
  ticket_vigente_del_ticket: "NO_TRADUCIDA",
};
