import type { ColumnType, Generated } from "kysely";

/** Una columna que fija la base: se lee, no se escribe. */
type DeLaBase<T> = ColumnType<T, never, never>;
/** Una columna que la aplicación escribe al insertar y no cambia nunca más. */
type SoloAlInsertar<T> = ColumnType<T, T, never>;

/** Las tablas de las devoluciones al proveedor (0084) y la lista del sistema que lee su motivo; `ComprasDb` las suma (el esquema de compras no pasa del tope de líneas). */
export type EsquemaDeDevoluciones = {
  /** N4 (0084): la lista del sistema de motivos (global); compras solo la lee, para mostrar el motivo de una devolución. */
  valor_de_lista: {
    id: string;
    lista: string;
    nombre: string;
    activo: boolean;
  };
  /** N4 (0084): la devolución de mercadería al proveedor. El número, la jornada y el momento de anular los fija la base. */
  devolucion_a_proveedor: {
    id: Generated<string>;
    empresa_id: string;
    numero: DeLaBase<number>;
    sucursal_id: SoloAlInsertar<string>;
    proveedor_id: SoloAlInsertar<string>;
    motivo_id: SoloAlInsertar<string>;
    remito_de_devolucion_numero: SoloAlInsertar<string | null>;
    remito_de_devolucion_fecha: SoloAlInsertar<string | null>;
    clave_idempotencia: SoloAlInsertar<string>;
    huella: SoloAlInsertar<string>;
    hecho_en: SoloAlInsertar<Date>;
    registrado_en: DeLaBase<Date>;
    fecha_negocio: DeLaBase<string>;
    estado: Generated<string>;
    registrado_por: SoloAlInsertar<string>;
    anulada_por: string | null;
    anulada_en: DeLaBase<Date | null>;
    motivo_de_anulacion: string | null;
    version: Generated<number>;
  };
  linea_de_devolucion: {
    empresa_id: string;
    devolucion_id: string;
    numero: number;
    deposito_id: string;
    articulo_id: string;
    cantidad: string;
    recepcion_id: string | null;
    linea_de_recepcion: number | null;
    movimiento_id: string;
    renglon_numero: number;
  };
};
