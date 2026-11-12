import type { Generated } from "kysely";

/**
 * Las dos tablas de la carta pública y del botón «Ocultar» (migración 0043, carta real §3.2 y §3.2b). Vive aparte para que `esquema.ts` no pase el tope de
 * líneas; el catálogo las suma a `CatalogoDb`, a las columnas que compara su prueba y al mapa de restricciones.
 */
export type TablasDeCarta = {
  carta_publica: {
    /** El que manda la aplicación (idempotencia del alta y semilla de la dirección de cada producto). */
    id: string;
    empresa_id: string;
    sucursal_id: string;
    /** Lo genera un puerto de azar (≥ 128 bits); no cambia nunca (disparador). */
    codigo: string;
    nombre: string;
    rubro: string | null;
    lugar: string | null;
    estado: Generated<string>;
    creado_por: string | null;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  disponibilidad_de_producto: {
    empresa_id: string;
    producto_id: string;
    /** Nulo = toda la empresa. */
    sucursal_id: string | null;
    oculto: boolean;
    actualizado_por: string | null;
    /** Lo pone la aplicación (el reloj de la composición), no `now()` de la base. */
    actualizado_en: Date;
    /** La sube el disparador; no se escribe. */
    version: Generated<number>;
  };
};

export const COLUMNAS_DE_CARTA = {
  carta_publica: [
    "id",
    "empresa_id",
    "sucursal_id",
    "codigo",
    "nombre",
    "rubro",
    "lugar",
    "estado",
    "creado_por",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  disponibilidad_de_producto: [
    "empresa_id",
    "producto_id",
    "sucursal_id",
    "oculto",
    "actualizado_por",
    "actualizado_en",
    "version",
  ],
} as const;

/**
 * Cada restricción de las dos tablas, y de lo que lanzan sus disparadores, con el error de negocio que le toca (`NO_TRADUCIDA` = nadie puede dispararla
 * por un camino de la aplicación, o no tiene error propio: sale como el error de persistencia tipado).
 */
export const ERRORES_DE_CARTA_POR_RESTRICCION: Readonly<Record<string, string>> = {
  // carta_publica
  carta_publica_pkey: "ID_REUTILIZADO",
  carta_publica_empresa_id_fkey: "NO_TRADUCIDA",
  carta_publica_creado_por_fkey: "NO_TRADUCIDA",
  carta_publica_id_empresa_uk: "NO_TRADUCIDA",
  carta_publica_sucursal_fkey: "SUCURSAL_NO_ENCONTRADA",
  carta_publica_sucursal_uk: "CARTA_DE_LA_SUCURSAL_YA_EXISTE",
  carta_publica_codigo_uk: "CODIGO_DE_CARTA_REPETIDO",
  carta_publica_codigo_ck: "CODIGO_DE_CARTA_INVALIDO",
  carta_publica_nombre_ck: "NOMBRE_DE_CARTA_INVALIDO",
  carta_publica_rubro_ck: "RUBRO_DE_CARTA_INVALIDO",
  carta_publica_lugar_ck: "LUGAR_DE_CARTA_INVALIDO",
  carta_publica_estado_ck: "NO_TRADUCIDA",
  carta_publica_codigo_inmutable: "NO_TRADUCIDA",
  carta_publica_sucursal_inmutable: "NO_TRADUCIDA",
  carta_publica_identidad_inmutable: "NO_TRADUCIDA",
  // disponibilidad_de_producto
  disponibilidad_de_producto_empresa_id_fkey: "NO_TRADUCIDA",
  disponibilidad_de_producto_actualizado_por_fkey: "NO_TRADUCIDA",
  disponibilidad_producto_fkey: "PRODUCTO_NO_ENCONTRADO",
  disponibilidad_sucursal_fkey: "SUCURSAL_NO_ENCONTRADA",
  disponibilidad_de_la_empresa_uk: "NO_TRADUCIDA",
  disponibilidad_del_local_uk: "NO_TRADUCIDA",
  disponibilidad_identidad_inmutable: "NO_TRADUCIDA",
};
