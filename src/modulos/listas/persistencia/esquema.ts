import type { Generated } from "kysely";

/**
 * Esquema de base de las listas del sistema (migración `0027_caja.sql`, tabla GLOBAL `valor_de_lista`: sin `empresa_id`, la primera tabla
 * global de negocio). Lo comparan las pruebas de integración contra la base real: si una restricción o una columna cambia en el SQL, esto
 * tiene que cambiar con ella. Las empresas (`pedernal_app`) solo la leen; la plataforma lee todo, agrega por `(lista, nombre)` y cambia
 * `(nombre, activo)`, y solo un ADMIN (la política de la base lo exige además del guard).
 */

/** Columnas de `valor_de_lista`, en el orden de la base. */
export const COLUMNAS_DE_VALOR_DE_LISTA = [
  "id",
  "lista",
  "nombre",
  "activo",
  "fija",
  "creado_en",
  "actualizado_en",
  "version",
] as const;

/** La tabla tal como la ve Kysely para la plataforma. Lo que fija la base (id, estado inicial, fechas, versión) va como `Generated`. */
export type ListasDb = {
  valor_de_lista: {
    id: Generated<string>;
    lista: "MARCAS_DE_TARJETA" | "MOTIVOS_DE_RECHAZO";
    nombre: string;
    activo: Generated<boolean>;
    fija: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
};

/**
 * Restricción de `valor_de_lista` → motivo tipado (ADR-004). Un test exige que no falte ninguna y que no sobre ninguna. Solo se traduce
 * lo que el usuario puede provocar con una carrera: el nombre repetido (lo gana quien llega primero, el otro recibe `VALOR_DUPLICADO`)
 * y tocar un valor fijo. Lo demás lo decide el dominio ANTES de escribir; si la base igual lo rechaza es un defecto y sale como el
 * error de persistencia tipado (`NO_TRADUCIDA`), nunca disfrazado. Los nombres «lo lanza un disparador» no son restricciones del
 * catálogo: los lanza `valor_de_lista_validar_cambio` con `CONSTRAINT = '...'` (SQLSTATE 23514).
 */
export const ERRORES_DE_LISTAS_POR_RESTRICCION = {
  valor_de_lista_pkey: "NO_TRADUCIDA",
  valor_de_lista_lista_ck: "NO_TRADUCIDA",
  valor_de_lista_nombre_ck: "NO_TRADUCIDA",
  valor_de_lista_fija_ck: "NO_TRADUCIDA",
  valor_de_lista_id_lista_uk: "NO_TRADUCIDA",
  valor_de_lista_nombre_uk: "VALOR_DUPLICADO",
  valor_de_lista_otra_uk: "NO_TRADUCIDA",
  valor_de_lista_inmutable: "NO_TRADUCIDA", // lo lanza un disparador
  valor_de_lista_fija: "VALOR_FIJO", // lo lanza un disparador
} as const satisfies Readonly<Record<string, string>>;

/** Los nombres que lanza el disparador de `valor_de_lista` con `ERRCODE '23514'`. */
export const RESTRICCIONES_DE_DISPARADORES_DE_LISTAS = [
  "valor_de_lista_inmutable",
  "valor_de_lista_fija",
] as const satisfies readonly (keyof typeof ERRORES_DE_LISTAS_POR_RESTRICCION)[];

type Mapa = typeof ERRORES_DE_LISTAS_POR_RESTRICCION;

/** Todo motivo al que puede traducirse una restricción de `valor_de_lista`. */
export type ErrorDeListasPorRestriccion = Exclude<Mapa[keyof Mapa], "NO_TRADUCIDA">;
