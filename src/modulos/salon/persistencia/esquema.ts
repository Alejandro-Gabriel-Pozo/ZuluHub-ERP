import type { Generated } from "kysely";

/**
 * Las tablas del salón (0038, E7). Una tabla de solo inserción no tiene columnas de actualización. Un test compara estas columnas con el catálogo de la
 * base (`salon-persistencia.test.ts`).
 */
export type SalonDb = {
  mesa: {
    id: string;
    empresa_id: string;
    sucursal_id: string;
    numero: number;
    forma: string;
    tamano: string;
    columna: number;
    fila: number;
    activa: Generated<boolean>;
    creada_por: string;
    creada_en: Date;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  mesa_celda: {
    empresa_id: string;
    sucursal_id: string;
    mesa_id: string;
    columna: number;
    fila: number;
    activa: Generated<boolean>;
    creado_en: Generated<Date>;
  };
  union_de_mesas: {
    id: string;
    empresa_id: string;
    sucursal_id: string;
    cuenta_destino_id: string;
    mesa_destino_id: string;
    cuenta_origen_id: string;
    mesa_origen_id: string;
    clave: string;
    unida_por: string;
    unida_en: Date;
    creado_en: Generated<Date>;
  };
  linea_unida: {
    empresa_id: string;
    linea_id: string;
    union_id: string;
    mesa_origen_id: string;
    creado_en: Generated<Date>;
  };
  division_de_cuenta: {
    id: string;
    empresa_id: string;
    sucursal_id: string;
    cuenta_madre_id: string;
    mesa_id: string;
    partes: number;
    dividida_por: string;
    dividida_en: Date;
    huella: string;
    creado_en: Generated<Date>;
  };
  parte_de_division: {
    empresa_id: string;
    division_id: string;
    numero: number;
    cuenta_id: string;
    creado_en: Generated<Date>;
  };
};

/** Tablas y columnas del módulo, en el orden de la base; un test las compara con el catálogo. */
export const COLUMNAS_DE_SALON = {
  mesa: [
    "id",
    "empresa_id",
    "sucursal_id",
    "numero",
    "forma",
    "tamano",
    "columna",
    "fila",
    "activa",
    "creada_por",
    "creada_en",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  mesa_celda: ["empresa_id", "sucursal_id", "mesa_id", "columna", "fila", "activa", "creado_en"],
  union_de_mesas: [
    "id",
    "empresa_id",
    "sucursal_id",
    "cuenta_destino_id",
    "mesa_destino_id",
    "cuenta_origen_id",
    "mesa_origen_id",
    "clave",
    "unida_por",
    "unida_en",
    "creado_en",
  ],
  linea_unida: ["empresa_id", "linea_id", "union_id", "mesa_origen_id", "creado_en"],
  division_de_cuenta: [
    "id",
    "empresa_id",
    "sucursal_id",
    "cuenta_madre_id",
    "mesa_id",
    "partes",
    "dividida_por",
    "dividida_en",
    "huella",
    "creado_en",
  ],
  parte_de_division: ["empresa_id", "division_id", "numero", "cuenta_id", "creado_en"],
} as const;
