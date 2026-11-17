import type { Generated } from "kysely";

/**
 * Las tablas de lotes de stock (0032, E6): control, lote, calidad, lotes de cada renglón del libro, saldo por lote y reasignaciones. Aparte de
 * `esquema.ts` para que ninguno de los dos archivos crezca de más. Los decimales llegan y se escriben como TEXTO (ADR-006); las fechas (`date`) se
 * leen con `::text` y se escriben con `::date`.
 */
export type TablasDeLotes = {
  /** E6 (0032): qué artículos llevan lote y cómo. Todo artículo nace sin control. */
  control_de_lote: {
    empresa_id: string;
    articulo_id: string;
    modo: string;
    con_calidad: Generated<boolean>;
    activo: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  /** E6 (0032): un lote de un artículo. Las fechas (`date`) se leen con `::text` y se escriben con `::date`. `calidad` la escribe solo la historia. */
  lote: {
    id: Generated<string>;
    empresa_id: string;
    articulo_id: string;
    codigo: string;
    referencia_de_origen: string | null;
    fecha_de_elaboracion: string | null;
    fecha_de_vencimiento: string | null;
    es_sin_asignar: Generated<boolean>;
    calidad: string | null;
    fecha_de_primer_ingreso: string;
    creado_por: string;
    creado_en: Date;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  /** E6 (0032): historia de calidad, solo inserción. */
  calidad_de_lote: {
    empresa_id: string;
    lote_id: string;
    estado: string;
    motivo: string;
    por: string;
    en: Date;
    orden: Generated<string>;
  };
  /** E6 (0032): de qué lote salió (o a cuál entró) cada renglón del libro; solo inserción. */
  renglon_de_lote: {
    empresa_id: string;
    movimiento_id: string;
    renglon_numero: number;
    lote_id: string;
    cantidad: string;
  };
  /** E6 (0032): la existencia por (depósito, artículo, lote); solo la escriben los disparadores. */
  saldo_de_lote: {
    empresa_id: string;
    deposito_id: string;
    articulo_id: string;
    lote_id: string;
    es_sin_asignar: boolean;
    existencia: string;
  };
  /** E6 (0032): movimientos de saldo entre lotes; sin origen es la apertura del control. Solo inserción. */
  reasignacion_de_lote: {
    id: Generated<string>;
    empresa_id: string;
    deposito_id: string;
    articulo_id: string;
    lote_origen_id: string | null;
    lote_destino_id: string;
    cantidad: string;
    motivo: string;
    clave_idempotencia: string;
    por: string;
    en: Date;
  };
};

export const COLUMNAS_DE_LOTES = {
  control_de_lote: [
    "empresa_id",
    "articulo_id",
    "modo",
    "con_calidad",
    "activo",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  lote: [
    "id",
    "empresa_id",
    "articulo_id",
    "codigo",
    "referencia_de_origen",
    "fecha_de_elaboracion",
    "fecha_de_vencimiento",
    "es_sin_asignar",
    "calidad",
    "fecha_de_primer_ingreso",
    "creado_por",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  calidad_de_lote: ["empresa_id", "lote_id", "estado", "motivo", "por", "en", "orden"],
  renglon_de_lote: ["empresa_id", "movimiento_id", "renglon_numero", "lote_id", "cantidad"],
  saldo_de_lote: [
    "empresa_id",
    "deposito_id",
    "articulo_id",
    "lote_id",
    "es_sin_asignar",
    "existencia",
  ],
  reasignacion_de_lote: [
    "id",
    "empresa_id",
    "deposito_id",
    "articulo_id",
    "lote_origen_id",
    "lote_destino_id",
    "cantidad",
    "motivo",
    "clave_idempotencia",
    "por",
    "en",
  ],
} as const satisfies { [Tabla in keyof TablasDeLotes]: readonly (keyof TablasDeLotes[Tabla])[] };
