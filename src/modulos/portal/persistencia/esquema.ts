import type { Generated } from "kysely";

/**
 * Las tres tablas del portal de la vidriera (migración 0078; diseño `carta-identidad-y-portal-datos-diseno.md` §2.3 a §2.5). Las comparan las pruebas de integración contra la
 * base real: si una columna o restricción cambia en el SQL, esto tiene que cambiar con ella.
 */
export type TablasDePortal = {
  portal_de_empresa: {
    /** Lo manda la aplicación: idempotencia del alta. */
    id: string;
    empresa_id: string;
    /** La llave pública del QR; lo genera un puerto de azar y no cambia nunca (disparador). */
    codigo: string;
    variante: Generated<string>;
    linea_superior: string | null;
    titulo: string | null;
    color_encabezado: string | null;
    color_pagina: string | null;
    color_detras: string | null;
    logo_visible: Generated<boolean>;
    imagen_proveedor: string | null;
    imagen_cuenta: string | null;
    imagen_id_publico: string | null;
    imagen_version: string | null;
    imagen_extension: string | null;
    creado_por: string | null;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  portal_tarjeta: {
    portal_id: string;
    sucursal_id: string;
    empresa_id: string;
    orden: number;
    visible: Generated<boolean>;
    nombre: string | null;
    telefono: string | null;
    foto_proveedor: string | null;
    foto_cuenta: string | null;
    foto_id_publico: string | null;
    foto_version: string | null;
    foto_extension: string | null;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  portal_zona: {
    id: string;
    empresa_id: string;
    portal_id: string;
    sucursal_id: string;
    /** `numeric(5,2)`: la base lo devuelve como texto decimal (porcentaje de la imagen). */
    x: string;
    y: string;
    ancho: string;
    alto: string;
    visible: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
};

export const COLUMNAS_DE_PORTAL = {
  portal_de_empresa: [
    "id",
    "empresa_id",
    "codigo",
    "variante",
    "linea_superior",
    "titulo",
    "color_encabezado",
    "color_pagina",
    "color_detras",
    "logo_visible",
    "imagen_proveedor",
    "imagen_cuenta",
    "imagen_id_publico",
    "imagen_version",
    "imagen_extension",
    "creado_por",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  portal_tarjeta: [
    "portal_id",
    "sucursal_id",
    "empresa_id",
    "orden",
    "visible",
    "nombre",
    "telefono",
    "foto_proveedor",
    "foto_cuenta",
    "foto_id_publico",
    "foto_version",
    "foto_extension",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  portal_zona: [
    "id",
    "empresa_id",
    "portal_id",
    "sucursal_id",
    "x",
    "y",
    "ancho",
    "alto",
    "visible",
    "creado_en",
    "actualizado_en",
    "version",
  ],
} as const;

/**
 * Lo que el rol `pedernal_publico` puede leer de cada tabla del portal (0078: `GRANT SELECT` por columna). Ni quién lo creó, ni cuándo, ni la versión. Cada consulta pública
 * pide EXACTAMENTE estas columnas y una prueba compara la lista con `information_schema.column_privileges`.
 */
export const COLUMNAS_PUBLICAS_DE_PORTAL = {
  portal_de_empresa: [
    "id",
    "empresa_id",
    "codigo",
    "variante",
    "linea_superior",
    "titulo",
    "color_encabezado",
    "color_pagina",
    "color_detras",
    "logo_visible",
    "imagen_proveedor",
    "imagen_cuenta",
    "imagen_id_publico",
    "imagen_version",
    "imagen_extension",
  ],
  portal_tarjeta: [
    "portal_id",
    "sucursal_id",
    "empresa_id",
    "orden",
    "visible",
    "nombre",
    "telefono",
    "foto_proveedor",
    "foto_cuenta",
    "foto_id_publico",
    "foto_version",
    "foto_extension",
  ],
  portal_zona: [
    "id",
    "empresa_id",
    "portal_id",
    "sucursal_id",
    "x",
    "y",
    "ancho",
    "alto",
    "visible",
  ],
} as const;

/**
 * Restricción (y lo que lanzan los disparadores con `CONSTRAINT = '…'`) → error de negocio (ADR-004). Una prueba exige que no falte ninguna ni sobre una que no existe.
 * `NO_TRADUCIDA`: nadie la dispara por un camino de la aplicación (el dominio valida antes) o es una clave: sale como el error de persistencia tipado, nunca disfrazada.
 */
export const ERRORES_DE_PORTAL_POR_RESTRICCION: Readonly<Record<string, string>> = {
  // portal_de_empresa
  portal_de_empresa_pkey: "ID_REUTILIZADO",
  portal_de_empresa_empresa_id_fkey: "NO_TRADUCIDA",
  portal_de_empresa_creado_por_fkey: "NO_TRADUCIDA",
  portal_de_empresa_codigo_ck: "NO_TRADUCIDA",
  portal_de_empresa_variante_ck: "VARIANTE_INVALIDA",
  portal_de_empresa_linea_ck: "LINEA_DEL_PORTAL_INVALIDA",
  portal_de_empresa_titulo_ck: "TITULO_DEL_PORTAL_INVALIDO",
  portal_de_empresa_color_encabezado_ck: "COLOR_INVALIDO",
  portal_de_empresa_color_pagina_ck: "COLOR_INVALIDO",
  portal_de_empresa_color_detras_ck: "COLOR_INVALIDO",
  portal_de_empresa_imagen_ck: "IMAGEN_DEL_PORTAL_INVALIDA",
  portal_de_empresa_id_empresa_uk: "NO_TRADUCIDA",
  portal_de_empresa_empresa_uk: "PORTAL_YA_EXISTE",
  portal_de_empresa_codigo_uk: "CODIGO_DE_PORTAL_REPETIDO",
  portal_de_empresa_codigo_inmutable: "NO_TRADUCIDA",
  portal_de_empresa_identidad_inmutable: "NO_TRADUCIDA",
  // portal_tarjeta
  portal_tarjeta_pkey: "TARJETA_REPETIDA",
  portal_tarjeta_empresa_id_fkey: "NO_TRADUCIDA",
  portal_tarjeta_orden_ck: "ORDEN_INVALIDO",
  portal_tarjeta_nombre_ck: "NOMBRE_DE_TARJETA_INVALIDO",
  portal_tarjeta_telefono_ck: "TELEFONO_DE_TARJETA_INVALIDO",
  portal_tarjeta_foto_ck: "FOTO_DE_TARJETA_INVALIDA",
  portal_tarjeta_portal_fkey: "NO_TRADUCIDA",
  portal_tarjeta_sucursal_fkey: "SUCURSAL_NO_ENCONTRADA",
  portal_hijo_identidad_inmutable: "NO_TRADUCIDA",
  portal_tarjeta_sucursal_inmutable: "NO_TRADUCIDA",
  // portal_zona
  portal_zona_pkey: "ID_REUTILIZADO",
  portal_zona_empresa_id_fkey: "NO_TRADUCIDA",
  portal_zona_x_ck: "ZONA_INVALIDA",
  portal_zona_y_ck: "ZONA_INVALIDA",
  portal_zona_ancho_ck: "ZONA_INVALIDA",
  portal_zona_alto_ck: "ZONA_INVALIDA",
  portal_zona_dentro_ck: "ZONA_INVALIDA",
  portal_zona_id_empresa_uk: "NO_TRADUCIDA",
  portal_zona_destino_uk: "ZONA_REPETIDA",
  portal_zona_portal_fkey: "NO_TRADUCIDA",
  portal_zona_sucursal_fkey: "SUCURSAL_NO_ENCONTRADA",
};
