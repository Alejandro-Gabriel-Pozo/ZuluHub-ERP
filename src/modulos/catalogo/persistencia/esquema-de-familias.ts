import type { Generated } from "kysely";

/**
 * Las tablas de las familias de productos (migraciones 0079, 0080 y 0081; A8). Viven aparte para que `esquema.ts` no pase el tope de líneas; el catálogo las suma a
 * `CatalogoDb`, a las columnas que compara su prueba y al mapa de restricciones.
 */
export type TablasDeFamilias = {
  seccion_de_carta: {
    /** El que manda la aplicación (idempotencia); si no lo manda, lo genera la base. */
    id: Generated<string>;
    empresa_id: string;
    nombre: string;
    nombre_clave: string;
    orden: number;
    activa: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  familia_de_producto: {
    /** El que manda la aplicación (idempotencia del alta). */
    id: string;
    empresa_id: string;
    nombre: string;
    nombre_clave: string;
    agrupar_en_carta: Generated<boolean>;
    agrupar_en_pos: Generated<boolean>;
    activa: Generated<boolean>;
    /** 0081: el lugar y la estrella del renglón en la carta (por empresa). */
    orden: Generated<number>;
    destacada: Generated<boolean>;
    creado_por: string | null;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  miembro_de_familia: {
    id: Generated<string>;
    empresa_id: string;
    familia_id: string;
    producto_id: string;
    posicion: number;
    agregado_por: string | null;
    agregado_en: Date;
    quitado_por: string | null;
    quitado_en: Date | null;
  };
  aplicacion_de_precio_de_familia: {
    id: string;
    empresa_id: string;
    familia_id: string;
    huella: string;
    precios_escritos: number;
    precios_sin_cambio: number;
    aplicada_por: string | null;
    aplicada_en: Date;
  };
  lugar_en_carta_de_producto: {
    empresa_id: string;
    producto_id: string;
    orden: Generated<number>;
    destacado: Generated<boolean>;
    actualizado_por: string | null;
    actualizado_en: Date;
    version: Generated<number>;
  };
};

export const COLUMNAS_DE_FAMILIAS = {
  seccion_de_carta: [
    "id",
    "empresa_id",
    "nombre",
    "nombre_clave",
    "orden",
    "activa",
    "creado_en",
    "actualizado_en",
    "version",
    // 0081 las agrega con ALTER TABLE: quedan al final.
    "orden_de_renglones",
    "version_del_orden",
  ],
  familia_de_producto: [
    "id",
    "empresa_id",
    "nombre",
    "nombre_clave",
    "agrupar_en_carta",
    "agrupar_en_pos",
    "activa",
    "creado_por",
    "creado_en",
    "actualizado_en",
    "version",
    // 0081 las agrega con ALTER TABLE: quedan al final.
    "orden",
    "destacada",
  ],
  miembro_de_familia: [
    "id",
    "empresa_id",
    "familia_id",
    "producto_id",
    "posicion",
    "agregado_por",
    "agregado_en",
    "quitado_por",
    "quitado_en",
  ],
  aplicacion_de_precio_de_familia: [
    "id",
    "empresa_id",
    "familia_id",
    "huella",
    "precios_escritos",
    "precios_sin_cambio",
    "aplicada_por",
    "aplicada_en",
  ],
  lugar_en_carta_de_producto: [
    "empresa_id",
    "producto_id",
    "orden",
    "destacado",
    "actualizado_por",
    "actualizado_en",
    "version",
  ],
} as const;

/** Cada restricción de las tablas de familias, y de lo que lanzan sus disparadores, con el error de negocio que le toca (`NO_TRADUCIDA` = nadie la dispara por un camino de la aplicación). */
export const ERRORES_DE_FAMILIAS_POR_RESTRICCION: Readonly<Record<string, string>> = {
  // familia_de_producto
  familia_de_producto_pkey: "ID_REUTILIZADO",
  familia_de_producto_empresa_id_fkey: "NO_TRADUCIDA",
  familia_de_producto_creado_por_fkey: "NO_TRADUCIDA",
  familia_id_empresa_uk: "NO_TRADUCIDA",
  familia_nombre_uk: "FAMILIA_DUPLICADA",
  familia_nombre_ck: "NOMBRE_DE_FAMILIA_INVALIDO",
  familia_nombre_clave_ck: "NOMBRE_DE_FAMILIA_INVALIDO",
  familia_orden_ck: "ORDEN_INVALIDO",
  familia_identidad_inmutable: "NO_TRADUCIDA",
  // miembro_de_familia
  miembro_de_familia_pkey: "NO_TRADUCIDA",
  miembro_de_familia_empresa_id_fkey: "NO_TRADUCIDA",
  miembro_de_familia_agregado_por_fkey: "NO_TRADUCIDA",
  miembro_de_familia_quitado_por_fkey: "NO_TRADUCIDA",
  miembro_id_empresa_uk: "NO_TRADUCIDA",
  miembro_quitado_ck: "NO_TRADUCIDA",
  miembro_posicion_ck: "FAMILIA_LLENA",
  miembro_familia_fkey: "FAMILIA_NO_ENCONTRADA",
  miembro_producto_fkey: "PRODUCTO_NO_ENCONTRADO",
  miembro_vigente_producto_uk: "PRODUCTO_EN_OTRA_FAMILIA",
  miembro_vigente_posicion_uk: "VERSION_DESACTUALIZADA",
  miembro_identidad_inmutable: "NO_TRADUCIDA",
  miembro_quitado_inmutable: "NO_TRADUCIDA",
  // aplicacion_de_precio_de_familia
  aplicacion_de_precio_de_familia_pkey: "ID_REUTILIZADO",
  aplicacion_de_precio_de_familia_empresa_id_fkey: "NO_TRADUCIDA",
  aplicacion_de_precio_de_familia_aplicada_por_fkey: "NO_TRADUCIDA",
  aplicacion_huella_ck: "NO_TRADUCIDA",
  aplicacion_escritos_ck: "NO_TRADUCIDA",
  aplicacion_sin_cambio_ck: "NO_TRADUCIDA",
  aplicacion_familia_fkey: "FAMILIA_NO_ENCONTRADA",
  aplicacion_inmutable: "NO_TRADUCIDA",
  // lugar_en_carta_de_producto
  lugar_en_carta_pk: "NO_TRADUCIDA",
  lugar_en_carta_de_producto_empresa_id_fkey: "NO_TRADUCIDA",
  lugar_en_carta_de_producto_actualizado_por_fkey: "NO_TRADUCIDA",
  lugar_orden_ck: "ORDEN_INVALIDO",
  lugar_producto_fkey: "PRODUCTO_NO_ENCONTRADO",
  lugar_identidad_inmutable: "NO_TRADUCIDA",
  // seccion_de_carta (columnas de 0081)
  seccion_orden_de_renglones_ck: "ORDEN_INVALIDO",
  seccion_version_del_orden_ck: "NO_TRADUCIDA",
  seccion_version_del_orden_salto: "NO_TRADUCIDA",
};
