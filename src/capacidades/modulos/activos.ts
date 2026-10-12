import type { DefinicionDeModulo } from "./catalogo";

/** ¿Es una clave propia del objeto? (Un nombre como "constructor" nunca cuenta.) */
export function esClaveDe<K extends string>(
  objeto: Readonly<Record<K, unknown>>,
  clave: string,
): clave is K {
  return Object.hasOwn(objeto, clave);
}

/** Las claves propias del objeto con su tipo (`Object.keys` las devuelve como `string`). */
export function clavesDe<K extends string>(objeto: Readonly<Record<K, unknown>>): K[] {
  return Object.keys(objeto) as K[];
}

/**
 * Los módulos activos de una empresa: los obligatorios más los activados que existen en el catálogo
 * y están disponibles. Una clave desconocida o de un módulo en desarrollo no habilita nada (falla
 * cerrado) y no impide los demás.
 */
export function modulosActivosDe<M extends string>(
  catalogo: Readonly<Record<M, Pick<DefinicionDeModulo, "estado" | "obligatorio">>>,
  activados: readonly string[],
): ReadonlySet<M> {
  const activos = new Set<M>(clavesDe(catalogo).filter((clave) => catalogo[clave].obligatorio));
  for (const clave of activados) {
    if (esClaveDe(catalogo, clave) && catalogo[clave].estado === "disponible") activos.add(clave);
  }
  return activos;
}
