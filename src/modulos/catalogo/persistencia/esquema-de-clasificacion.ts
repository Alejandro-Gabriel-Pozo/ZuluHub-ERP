import type { Generated } from "kysely";

/**
 * La tabla de la clasificación comercial (departamento → categoría → …, migración 0045). Vive aparte para que `esquema.ts` no pase el tope de líneas: el catálogo la suma
 * a `CatalogoDb`, a las columnas que compara su prueba y al mapa de restricciones.
 */
export type TablasDeClasificacion = {
  nodo_de_clasificacion: {
    /** El que manda la aplicación (idempotencia). */
    id: string;
    empresa_id: string;
    /** `null` = departamento (primer nivel). */
    padre_id: string | null;
    nombre: string;
    nombre_clave: string;
    activo: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
};

export const COLUMNAS_DE_CLASIFICACION = {
  nodo_de_clasificacion: [
    "id",
    "empresa_id",
    "padre_id",
    "nombre",
    "nombre_clave",
    "activo",
    "creado_en",
    "actualizado_en",
    "version",
  ],
} as const;

/**
 * Las restricciones de 0045 y el error de negocio de cada una. Las del árbol (ciclo, tope, raíz fija, activo e inactivo) las decide ANTES la primitiva
 * `src/primitivas/clasificacion/arbol.ts` con el candado de la empresa tomado; que lleguen desde la base es una carrera que el candado no cubrió o un árbol dañado, y
 * salen con el mismo nombre que la primitiva.
 */
export const ERRORES_DE_CLASIFICACION_POR_RESTRICCION: Readonly<Record<string, string>> = {
  nodo_de_clasificacion_pkey: "ID_REUTILIZADO",
  nodo_de_clasificacion_empresa_id_fkey: "NO_TRADUCIDA",
  nodo_de_clasificacion_id_empresa_uk: "NO_TRADUCIDA",
  nodo_de_clasificacion_nombre_ck: "NOMBRE_DE_NODO_INVALIDO",
  nodo_de_clasificacion_nombre_clave_ck: "NOMBRE_DE_NODO_INVALIDO",
  nodo_de_clasificacion_nombre_uk: "NODO_DUPLICADO",
  nodo_de_clasificacion_padre_fkey: "PADRE_INEXISTENTE",
  nodo_de_clasificacion_padre_distinto_ck: "CICLO",
  nodo_de_clasificacion_inmutable: "NO_TRADUCIDA",
  nodo_de_clasificacion_raiz_fija: "DEPARTAMENTO_NO_SE_MUEVE",
  nodo_de_clasificacion_ciclo: "CICLO",
  nodo_de_clasificacion_tope: "TOPE_DE_NIVELES",
  nodo_de_clasificacion_padre_desactivado: "PADRE_DESACTIVADO",
  nodo_de_clasificacion_hijos_activos: "TIENE_HIJOS_ACTIVOS",
};
