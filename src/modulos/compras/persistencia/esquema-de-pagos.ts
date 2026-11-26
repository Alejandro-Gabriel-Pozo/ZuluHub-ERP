import type { EsquemaDeDevoluciones } from "./esquema-de-devoluciones";

/**
 * La tabla de los medios de un pago (0103: una línea por medio, solo inserción; la suma de las líneas es el importe del pago, lo exige la base) y las tablas de las devoluciones (0084). `ComprasDb` las suma
 * (el esquema de compras no pasa del tope de líneas).
 */
export type EsquemaDePagosYDevoluciones = EsquemaDeDevoluciones & {
  medio_de_un_pago: {
    empresa_id: string;
    pago_id: string;
    numero: number;
    medio: string;
    importe: string;
  };
};
