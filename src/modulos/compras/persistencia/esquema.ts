import type { ColumnType, Generated } from "kysely";

/** Una columna que fija la base: se lee, no se escribe. */
type DeLaBase<T> = ColumnType<T, never, never>;
/** Una columna que la aplicación escribe al insertar y no cambia nunca más. */
type SoloAlInsertar<T> = ColumnType<T, T, never>;
/** Los decimales (`numeric`) llegan y se escriben como TEXTO exacto (ADR-006); las fechas `date`, como texto `YYYY-MM-DD` (se leen con `::text`). */

/**
 * Las tablas de compras (0037) y las del catálogo que compras lee (producto, unidad). Un test compara estas columnas con el catálogo de la base
 * (`compras-persistencia.test.ts`). Los saldos de las líneas los escribe solo la base (disparador): la aplicación nunca los inserta ni los cambia.
 */
export type ComprasDb = {
  producto: {
    id: string;
    empresa_id: string;
    nombre: string;
    clase_de_uso: string;
    unidad_base_id: string;
    dimension: string;
    activo: boolean;
  };
  configuracion_de_compras: {
    empresa_id: string;
    nivel: Generated<string>;
    version: Generated<number>;
  };
  ficha_de_compra_del_proveedor: {
    empresa_id: string;
    parte_id: string;
    letra_esperada: string | null;
    version: Generated<number>;
  };
  comprobante_de_la_ficha: {
    empresa_id: string;
    parte_id: string;
    tipo: string;
    activo: Generated<boolean>;
    version: Generated<number>;
  };
  punto_de_venta_de_la_ficha: {
    empresa_id: string;
    parte_id: string;
    numero: number;
    activo: Generated<boolean>;
    version: Generated<number>;
  };
  pedido_de_ficha: {
    id: Generated<string>;
    empresa_id: string;
    parte_id: string;
    objeto: string;
    valor: string;
    estado: Generated<string>;
    pedido_por: string;
    pedido_en: Generated<Date>;
    resuelto_por: string | null;
    resuelto_en: Date | null;
    version: Generated<number>;
  };
  oferta_de_proveedor: {
    id: Generated<string>;
    empresa_id: string;
    proveedor_id: string;
    producto_id: string;
    presentacion_id: string | null;
    precio_por_tipo: string;
    unidad_de_precio_id: string | null;
    ultimo_precio: string;
    ultimo_costo_por_unidad_de_stock: string;
    ultima_compra_id: string;
    ultima_compra_en: Date;
    version: Generated<number>;
  };
  recepcion: {
    id: Generated<string>;
    empresa_id: string;
    sucursal_id: string;
    proveedor_id: string;
    numero: DeLaBase<number>;
    nivel: string;
    es_atajo: boolean;
    remito_punto_de_venta: number | null;
    remito_numero: number | null;
    remito_fecha: string | null;
    hecho_en: Date;
    registrado_en: DeLaBase<Date>;
    fecha_negocio: DeLaBase<string>;
    estado: Generated<string>;
    clave_idempotencia: SoloAlInsertar<string>;
    huella: SoloAlInsertar<string>;
    registrado_por: SoloAlInsertar<string>;
    anulada_por: string | null;
    anulada_en: Date | null;
    motivo_de_anulacion: string | null;
    version: Generated<number>;
  };
  linea_de_recepcion: {
    empresa_id: string;
    recepcion_id: string;
    numero: number;
    producto_id: string;
    presentacion_id: string | null;
    unidad_de_compra_id: string;
    cantidad_de_compra: string;
    de_peso_variable: boolean;
    peso_real: string | null;
    cantidad_en_stock: string;
    precio_por_tipo: string | null;
    unidad_de_precio_id: string | null;
    precio: string | null;
    importe: string | null;
    costo_por_unidad_de_stock: string | null;
    deposito_id: string | null;
    movimiento_id: string | null;
    registrado_en: DeLaBase<Date>;
  };
  saldo_de_linea_de_recepcion: {
    empresa_id: string;
    recepcion_id: string;
    numero: number;
    cantidad_recibida: DeLaBase<string>;
    cantidad_asignada: DeLaBase<string>;
  };
  comprobante_de_proveedor: {
    id: Generated<string>;
    empresa_id: string;
    proveedor_id: string;
    clase: string;
    tipo: string | null;
    punto_de_venta: number | null;
    numero: number | null;
    fecha_del_comprobante: string | null;
    fecha_de_vencimiento_de_pago: string | null;
    neto_gravado: string;
    no_gravado: string;
    exento: string;
    iva: string;
    tributos_total: string;
    credito_fiscal_computable: string;
    total_calculado: string;
    total_segun_factura: string;
    moneda: Generated<string>;
    proveedor_cuit: string | null;
    proveedor_razon_social: string;
    letra_no_esperada: Generated<boolean>;
    nivel: string;
    es_atajo: boolean;
    estado: Generated<string>;
    fecha_negocio: DeLaBase<string>;
    registrado_en: DeLaBase<Date>;
    clave_idempotencia: SoloAlInsertar<string>;
    huella: SoloAlInsertar<string>;
    registrado_por: SoloAlInsertar<string>;
    anulado_por: string | null;
    anulado_en: Date | null;
    motivo_de_anulacion: string | null;
    version: Generated<number>;
  };
  linea_de_comprobante: {
    empresa_id: string;
    comprobante_id: string;
    numero: number;
    descripcion: string;
    unidad: string;
    cantidad_facturada: string;
    precio_neto: string;
    alicuota: string | null;
    neto_de_linea: string;
    iva_de_linea: string;
    recepcion_id: string | null;
    linea_de_recepcion: number | null;
    registrado_en: DeLaBase<Date>;
  };
  importe_por_alicuota: {
    empresa_id: string;
    comprobante_id: string;
    alicuota: string;
    neto: string;
    iva: string;
    registrado_en: DeLaBase<Date>;
  };
  tributo_de_comprobante: {
    empresa_id: string;
    comprobante_id: string;
    numero: number;
    tipo: string;
    descripcion: string | null;
    base_imponible: string | null;
    alicuota: string | null;
    importe: string;
    registrado_en: DeLaBase<Date>;
  };
  saldo_de_linea_de_comprobante: {
    empresa_id: string;
    comprobante_id: string;
    numero: number;
    cantidad_facturada: DeLaBase<string>;
    cantidad_asignada: DeLaBase<string>;
  };
  conciliacion: {
    id: Generated<string>;
    empresa_id: string;
    acto: string;
    anula_a: string | null;
    comprobante_id: string;
    es_atajo: Generated<boolean>;
    nivel: string;
    clave_idempotencia: string;
    registrado_en: DeLaBase<Date>;
    registrado_por: string;
  };
  asignacion_de_conciliacion: {
    empresa_id: string;
    conciliacion_id: string;
    acto: string;
    numero: number;
    comprobante_id: string;
    linea_de_comprobante: number;
    recepcion_id: string;
    linea_de_recepcion: number;
    cantidad: string;
  };
  pago_de_comprobante: {
    id: Generated<string>;
    empresa_id: string;
    comprobante_id: string;
    fecha_de_pago: string;
    medio: string;
    importe: string;
    moneda: Generated<string>;
    estado: Generated<string>;
    clave_idempotencia: SoloAlInsertar<string>;
    huella: SoloAlInsertar<string>;
    registrado_en: DeLaBase<Date>;
    registrado_por: SoloAlInsertar<string>;
    anulado_por: string | null;
    anulado_en: Date | null;
    motivo_de_anulacion: string | null;
    version: Generated<number>;
  };
  correccion_de_compra: {
    empresa_id: string;
    recepcion_id: string;
    linea: number;
    numero: number;
    precio_anterior: string | null;
    precio_nuevo: string | null;
    cantidad_anterior: string | null;
    cantidad_nueva: string | null;
    motivo: string;
    clave_idempotencia: string;
    huella: string;
    registrado_en: DeLaBase<Date>;
    registrado_por: string;
  };
};
