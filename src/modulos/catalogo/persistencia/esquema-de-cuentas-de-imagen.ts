import type { Generated } from "kysely";

/**
 * La tabla de las cuentas de imagen declaradas por empresa (migración 0102). Vive aparte para que `esquema.ts` no pase el tope de líneas; el catálogo la suma a
 * `CatalogoDb`, a las columnas que compara su prueba y al mapa de restricciones. El rol público también la lee (solo `empresa_id`, `proveedor`, `cuenta`, `estado`).
 */
export type TablasDeCuentasDeImagen = {
  cuenta_de_imagen_declarada: {
    /** Lo genera la base. */
    id: Generated<string>;
    empresa_id: string;
    proveedor: string;
    cuenta: string;
    estado: Generated<string>;
    clave_idempotencia: string;
    huella: string;
    declarada_por: string;
    declarada_en: Generated<Date>;
    retirada_por: string | null;
    /** La fija el disparador al retirar. */
    retirada_en: Date | null;
    motivo_de_retiro: string | null;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
};

export const COLUMNAS_DE_CUENTAS_DE_IMAGEN = {
  cuenta_de_imagen_declarada: [
    "id",
    "empresa_id",
    "proveedor",
    "cuenta",
    "estado",
    "clave_idempotencia",
    "huella",
    "declarada_por",
    "declarada_en",
    "retirada_por",
    "retirada_en",
    "motivo_de_retiro",
    "actualizado_en",
    "version",
  ],
} as const;

/** Cada restricción de la tabla y de lo que lanzan sus disparadores, con el error de negocio que le toca (`NO_TRADUCIDA` = nadie la dispara por un camino de la aplicación). */
export const ERRORES_DE_CUENTAS_DE_IMAGEN_POR_RESTRICCION: Readonly<Record<string, string>> = {
  cuenta_de_imagen_declarada_pkey: "NO_TRADUCIDA",
  cuenta_de_imagen_declarada_empresa_id_fkey: "NO_TRADUCIDA",
  cuenta_de_imagen_declarada_declarada_por_fkey: "NO_TRADUCIDA",
  cuenta_de_imagen_declarada_retirada_por_fkey: "NO_TRADUCIDA",
  cuenta_de_imagen_id_empresa_uk: "NO_TRADUCIDA",
  cuenta_de_imagen_clave_uk: "NO_TRADUCIDA",
  cuenta_de_imagen_activa_uk: "CUENTA_DE_IMAGEN_YA_DECLARADA",
  cuenta_de_imagen_proveedor_ck: "CUENTA_DE_IMAGEN_INVALIDA",
  cuenta_de_imagen_cuenta_ck: "CUENTA_DE_IMAGEN_INVALIDA",
  cuenta_de_imagen_estado_ck: "NO_TRADUCIDA",
  cuenta_de_imagen_clave_ck: "NO_TRADUCIDA",
  cuenta_de_imagen_huella_ck: "NO_TRADUCIDA",
  cuenta_de_imagen_motivo_ck: "NO_TRADUCIDA",
  cuenta_de_imagen_retiro_ck: "NO_TRADUCIDA",
  cuenta_de_imagen_tope: "CUENTA_DE_IMAGEN_TOPE",
  cuenta_de_imagen_inmutable: "NO_TRADUCIDA",
  cuenta_de_imagen_transicion_invalida: "NO_TRADUCIDA",
  // Lo que lanza el disparador de `carta_publica` cuando el logo es de una cuenta que la empresa no declaró (o retiró).
  carta_publica_logo_cuenta_declarada: "LOGO_DE_CARTA_CUENTA_NO_DECLARADA",
};
