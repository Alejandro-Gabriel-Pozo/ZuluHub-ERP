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
 * Cómo está cada módulo para el guard de una empresa. Los dos conjuntos son DISJUNTOS; lo que no
 * está en ninguno es «no activo».
 */
export type EstadoDeModulos<M extends string> = Readonly<{
  /** Operan sin restricción. */
  modulosActivos: ReadonlySet<M>;
  /** Activados por la empresa, pero fuera del techo de su plan: solo lectura (corrección 16). */
  modulosEnSoloLectura: ReadonlySet<M>;
}>;

/**
 * El estado de los módulos de una empresa (marcas y planes, §B.6), a partir de tres datos leídos en
 * la misma transacción: lo que la empresa `activados` y lo que su plan `habilitados` (el techo).
 *  - activos = obligatorios ∪ (activados ∩ habilitados ∩ disponibles);
 *  - en solo lectura = (activados ∩ disponibles) ∖ habilitados, sin los obligatorios: el núcleo no
 *    depende de un plan y nunca baja a solo lectura;
 *  - no activo = lo demás.
 * Una clave desconocida, en ambas listas, o de un módulo en desarrollo no habilita nada (falla
 * cerrado) y no impide los demás. Los obligatorios no necesitan estar en `habilitados`. Pura: no
 * modifica sus entradas, y repetir una clave no cambia nada.
 */
export function estadoDeModulos<M extends string>(
  catalogo: Readonly<Record<M, Pick<DefinicionDeModulo, "estado" | "obligatorio">>>,
  activados: readonly string[],
  habilitados: readonly string[],
): EstadoDeModulos<M> {
  const modulosActivos = new Set<M>(
    clavesDe(catalogo).filter((clave) => catalogo[clave].obligatorio),
  );
  const modulosEnSoloLectura = new Set<M>();
  const delPlan = new Set(habilitados);
  for (const clave of activados) {
    if (!esClaveDe(catalogo, clave)) continue;
    const { estado, obligatorio } = catalogo[clave];
    if (obligatorio || estado !== "disponible") continue;
    if (delPlan.has(clave)) modulosActivos.add(clave);
    else modulosEnSoloLectura.add(clave);
  }
  return { modulosActivos, modulosEnSoloLectura };
}
