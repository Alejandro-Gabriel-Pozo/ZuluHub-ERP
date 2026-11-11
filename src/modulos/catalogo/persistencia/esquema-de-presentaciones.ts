import type { Generated } from "kysely";

/**
 * La tabla de presentaciones de un producto («caja de 12», «pieza ≈ 4 kg»: cómo se compra, E9 §3.2, X5). La crea la migración 0037 (compras la referencia con
 * claves foráneas compuestas) pero el dueño del dato es el catálogo. Vive aparte para que `esquema.ts` no pase el tope de líneas; el catálogo la suma a
 * `CatalogoDb`, a las columnas que compara su prueba y al mapa de restricciones.
 */
export type TablasDePresentaciones = {
  presentacion_de_producto: {
    id: Generated<string>;
    empresa_id: string;
    producto_id: string;
    nombre: string;
    nombre_clave: string;
    cantidad: string;
    de_peso_variable: Generated<boolean>;
    activa: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
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

export const COLUMNAS_DE_PRESENTACIONES = {
  presentacion_de_producto: [
    "id",
    "empresa_id",
    "producto_id",
    "nombre",
    "nombre_clave",
    "cantidad",
    "de_peso_variable",
    "activa",
    "creado_en",
    "actualizado_en",
    "version",
  ],
} as const;

export const ERRORES_DE_PRESENTACIONES_POR_RESTRICCION: Readonly<Record<string, string>> = {
  presentacion_cantidad_ck: "NO_TRADUCIDA",
  presentacion_de_producto_empresa_id_fkey: "NO_TRADUCIDA",
  presentacion_de_producto_pkey: "NO_TRADUCIDA",
  presentacion_id_empresa_uk: "NO_TRADUCIDA",
  presentacion_nombre_ck: "NO_TRADUCIDA",
  presentacion_nombre_clave_ck: "NO_TRADUCIDA",
  presentacion_nombre_uk: "PRESENTACION_REPETIDA",
  presentacion_producto_fkey: "PRODUCTO_NO_ENCONTRADO",
};
