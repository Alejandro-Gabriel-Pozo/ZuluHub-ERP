import type { ColumnType, Generated } from "kysely";

/** Una columna que fija la base: se lee, no se escribe. */
type DeLaBase<T> = ColumnType<T, never, never>;

/**
 * Las tablas de producción (0033). Los decimales (`numeric`) llegan y se escriben como TEXTO exacto (ADR-006) y las fechas `date` se leen con `::text`.
 * El número de la orden y la fecha de negocio los fija la base (disparadores): la aplicación nunca los manda. Un test compara estas columnas con el
 * catálogo de la base (`produccion-persistencia.test.ts`).
 */
export type ProduccionDb = {
  contador_de_ordenes: { empresa_id: string; ultimo: DeLaBase<number> };
  orden_de_produccion: {
    id: string;
    empresa_id: string;
    numero: DeLaBase<number>;
    tipo: Generated<string>;
    estado: Generated<string>;
    producto_id: string;
    articulo_id: string;
    composicion_id: string;
    deposito_id: string;
    deposito_destino_id: string;
    cantidad_esperada: string;
    cantidad_obtenida: string | null;
    lote_id: string | null;
    vence: string | null;
    costo_unitario: string | null;
    costo_estado: string | null;
    moneda: Generated<string>;
    movimiento_de_consumo_id: string | null;
    movimiento_de_producto_id: string | null;
    anulacion_de_consumo_id: string | null;
    anulacion_de_producto_id: string | null;
    motivo: string | null;
    abierta_por: string;
    abierta_en: Date;
    cerrada_por: string | null;
    cerrada_en: Date | null;
    cancelada_por: string | null;
    cancelada_en: Date | null;
    anulada_por: string | null;
    anulada_en: Date | null;
    hecho_en: DeLaBase<Date | null>;
    fecha_de_negocio: DeLaBase<string | null>;
    creado_en: DeLaBase<Date>;
    actualizado_en: DeLaBase<Date>;
    version: DeLaBase<number>;
  };
  renglon_de_orden: {
    empresa_id: string;
    orden_id: string;
    numero: number;
    articulo_id: string;
    composicion_id: string | null;
    cantidad_esperada: string;
    cantidad_real: string | null;
  };
};
