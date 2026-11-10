import type { Generated } from "kysely";
import type { EstadoDeConteo } from "../estados";

/**
 * Las tablas de la contribución de caja al cierre del día (0027; e3b §4.4 y §4.6) que no son la corrección de medio: las declaraciones y
 * el «conforme general» que se escriben con la jornada en auditoría, y la foto que caja congela al cerrarla (cabecera, líneas de la
 * conciliación y cobrado contra el ticket). Aparte de `esquema.ts` para que ningún archivo pase de 400 líneas; `CajaDb` las suma.
 */
export type TablasDelCierreDeCaja = {
  declaracion_de_total: {
    id: Generated<string>;
    empresa_id: string;
    sucursal_id: string;
    fecha_negocio: string;
    medio_de_pago_id: string;
    cuenta_de_cobro_id: string | null;
    secuencia: number;
    moneda: Generated<string>;
    importe: string;
    declarado_en: Date;
    declarado_por: string;
    clave_idempotencia: string;
    huella: string;
    creado_en: Generated<Date>;
  };
  conforme_de_jornada: {
    id: Generated<string>;
    empresa_id: string;
    sucursal_id: string;
    fecha_negocio: string;
    conforme_por: string;
    conforme_en: Date;
    clave_idempotencia: string;
    huella: string;
    creado_en: Generated<Date>;
  };
  cierre_de_caja_de_jornada: {
    empresa_id: string;
    sucursal_id: string;
    fecha_negocio: string;
    congelado_en: Date;
    congelado_por: string;
    creado_en: Generated<Date>;
  };
  conciliacion_de_jornada: {
    empresa_id: string;
    sucursal_id: string;
    fecha_negocio: string;
    medio_de_pago_id: string;
    cuenta_de_cobro_id: string | null;
    moneda: Generated<string>;
    registrado: string;
    correcciones: string;
    declarado: string | null;
    estado_de_conteo: EstadoDeConteo;
    conforme_por: string | null;
    conforme_en: Date | null;
    diferencia: Generated<string | null>;
    explicacion: string | null;
    creado_en: Generated<Date>;
  };
  conciliacion_de_cobro_por_origen: {
    empresa_id: string;
    sucursal_id: string;
    fecha_negocio: string;
    origen_tipo: string;
    origen_id: string;
    ticket_id: string;
    moneda: Generated<string>;
    cobrado: string;
    total_del_ticket: string;
    diferencia: Generated<string>;
    explicacion: string | null;
    creado_en: Generated<Date>;
  };
};

/** Tablas y columnas, en el orden de la base; un test las compara con el catálogo de la base. */
export const COLUMNAS_DEL_CIERRE_DE_CAJA = {
  declaracion_de_total: [
    "id",
    "empresa_id",
    "sucursal_id",
    "fecha_negocio",
    "medio_de_pago_id",
    "cuenta_de_cobro_id",
    "secuencia",
    "moneda",
    "importe",
    "declarado_en",
    "declarado_por",
    "clave_idempotencia",
    "huella",
    "creado_en",
  ],
  conforme_de_jornada: [
    "id",
    "empresa_id",
    "sucursal_id",
    "fecha_negocio",
    "conforme_por",
    "conforme_en",
    "clave_idempotencia",
    "huella",
    "creado_en",
  ],
  cierre_de_caja_de_jornada: [
    "empresa_id",
    "sucursal_id",
    "fecha_negocio",
    "congelado_en",
    "congelado_por",
    "creado_en",
  ],
  conciliacion_de_jornada: [
    "empresa_id",
    "sucursal_id",
    "fecha_negocio",
    "medio_de_pago_id",
    "cuenta_de_cobro_id",
    "moneda",
    "registrado",
    "correcciones",
    "declarado",
    "estado_de_conteo",
    "conforme_por",
    "conforme_en",
    "diferencia",
    "explicacion",
    "creado_en",
  ],
  conciliacion_de_cobro_por_origen: [
    "empresa_id",
    "sucursal_id",
    "fecha_negocio",
    "origen_tipo",
    "origen_id",
    "ticket_id",
    "moneda",
    "cobrado",
    "total_del_ticket",
    "diferencia",
    "explicacion",
    "creado_en",
  ],
} as const;
