import type { ColumnType } from "kysely";
import type { EsquemaDeDevoluciones } from "./esquema-de-devoluciones";

/**
 * La corrección de lo recibido (0098), la tabla de los medios de un pago (0103: una línea por medio, solo inserción; la suma de las líneas es el importe del pago, lo exige la base) y las tablas de las devoluciones (0084). `ComprasDb` las suma
 * (el esquema de compras no pasa del tope de líneas).
 */
export type EsquemaDePagosYDevoluciones = EsquemaDeDevoluciones & {
  /** N3 (0098): la corrección de lo recibido de una línea de recepción separada confirmada. Solo inserción; la base ajusta el saldo de la línea al insertarla. */
  correccion_de_lo_recibido: {
    id: string;
    empresa_id: string;
    recepcion_id: string;
    linea: number;
    numero: number;
    cantidad_anterior: string;
    cantidad_nueva: string;
    causa: string;
    nota: string | null;
    movimiento_id: string;
    clave_idempotencia: string;
    huella: string;
    registrado_en: ColumnType<Date, never, never>;
    registrado_por: string;
  };
  medio_de_un_pago: {
    empresa_id: string;
    pago_id: string;
    numero: number;
    medio: string;
    importe: string;
  };
};
