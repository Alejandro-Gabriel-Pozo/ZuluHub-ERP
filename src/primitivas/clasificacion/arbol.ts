import { err, ok, type Resultado } from "../resultado/resultado";

/**
 * REGLAS DEL ÁRBOL DE CLASIFICACIÓN COMERCIAL (departamento → categoría → niveles inferiores; ficha de concepto
 * `Pedernal-docs/11-especificaciones/conceptos/clasificacion-comercial-y-seccion-de-la-carta.md` §2, plan aprobado por el dueño el 12/11/2026). Funciones PURAS sobre una
 * foto del árbol de UNA empresa (id → nodo): las usan los casos de uso para decidir y la pantalla para apagar los destinos inválidos. Es la única fuente de la regla: la
 * base (`nodo_de_clasificacion_validar`, 0045) la repite como defensa en profundidad y una prueba de integración compara el tope.
 *
 * Todo nace cerrado: un árbol que no cumple (un padre que no existe, un ciclo, más niveles que el tope) NUNCA se interpreta, devuelve `ARBOL_INCONSISTENTE`.
 * Niveles: 1 = departamento (sin padre); el tope es `MAXIMO_DE_NIVELES_DE_CLASIFICACION`, fijado UNA vez por la plataforma y nunca reducible (reducirlo dejaría
 * árboles que ya no cumplen). Un departamento no se mueve ni pasa nadie a primer nivel (supuesto S3 de la maqueta). Previene: un ciclo por dos movimientos a la vez,
 * un subárbol que se pasa del tope al moverlo y un nodo vivo colgado de uno desactivado.
 */
export const MAXIMO_DE_NIVELES_DE_CLASIFICACION = 4;

export type NodoDeClasificacion = Readonly<{
  id: string;
  /** `null` = departamento (primer nivel). */
  padreId: string | null;
  activo: boolean;
}>;
export type ArbolDeClasificacion = ReadonlyMap<string, NodoDeClasificacion>;

export type MotivoDeArbol = "NODO_INEXISTENTE" | "ARBOL_INCONSISTENTE";
export type MotivoDeRechazoDeClasificacion =
  | MotivoDeArbol
  | "PADRE_INEXISTENTE"
  | "PADRE_DESACTIVADO"
  | "CICLO"
  | "TOPE_DE_NIVELES"
  | "DEPARTAMENTO_NO_SE_MUEVE"
  | "TIENE_HIJOS_ACTIVOS";

/**
 * Los ids del camino de un nodo, del departamento hasta el propio nodo (es lo que se copia al renglón de venta). Un ciclo, un padre que falta o más niveles que el tope
 * no se interpretan: `ARBOL_INCONSISTENTE`.
 */
export function caminoDeNodo(
  arbol: ArbolDeClasificacion,
  id: string,
): Resultado<readonly string[], MotivoDeArbol> {
  let actual = arbol.get(id);
  if (actual === undefined) return err("NODO_INEXISTENTE");
  const camino = [id];
  while (actual.padreId !== null) {
    if (camino.length >= MAXIMO_DE_NIVELES_DE_CLASIFICACION) return err("ARBOL_INCONSISTENTE");
    actual = arbol.get(actual.padreId);
    if (actual === undefined) return err("ARBOL_INCONSISTENTE");
    camino.unshift(actual.id);
  }
  return ok(camino);
}

/** El nivel de un nodo (1 = departamento): el largo de su camino. */
export function nivelDeNodo(
  arbol: ArbolDeClasificacion,
  id: string,
): Resultado<number, MotivoDeArbol> {
  const camino = caminoDeNodo(arbol, id);
  return camino.ok ? ok(camino.valor.length) : camino;
}

/** La altura del subárbol que cuelga de un nodo, contando al propio nodo (1 = no tiene hijos, vivos o desactivados). */
function alturaDelSubarbol(
  arbol: ArbolDeClasificacion,
  id: string,
): Resultado<number, "ARBOL_INCONSISTENTE"> {
  // El padre de un departamento es `null`, que nunca está entre los ids de `actuales`: no hace falta mirarlo aparte.
  let actuales: ReadonlySet<string | null> = new Set([id]);
  let altura = 0;
  while (actuales.size > 0) {
    altura += 1;
    if (altura > MAXIMO_DE_NIVELES_DE_CLASIFICACION) return err("ARBOL_INCONSISTENTE");
    const siguientes = new Set<string | null>();
    for (const nodo of arbol.values()) {
      if (actuales.has(nodo.padreId)) siguientes.add(nodo.id);
    }
    actuales = siguientes;
  }
  return ok(altura);
}

/** ¿Se puede crear un nodo nuevo bajo ese padre? `null` = un departamento (siempre se puede). */
export function puedeCrearBajo(
  arbol: ArbolDeClasificacion,
  padreId: string | null,
): Resultado<null, MotivoDeRechazoDeClasificacion> {
  if (padreId === null) return ok(null);
  const padre = arbol.get(padreId);
  if (padre === undefined) return err("PADRE_INEXISTENTE");
  if (!padre.activo) return err("PADRE_DESACTIVADO");
  const nivel = nivelDeNodo(arbol, padreId);
  if (!nivel.ok) return err("ARBOL_INCONSISTENTE");
  return nivel.valor + 1 > MAXIMO_DE_NIVELES_DE_CLASIFICACION ? err("TOPE_DE_NIVELES") : ok(null);
}

/**
 * ¿Se puede mover un nodo (con todo lo que tiene adentro) bajo ese padre? Un departamento no se mueve; el padre existe y está activo; no es el propio nodo ni uno de sus
 * descendientes (ciclo); y el nivel del padre más la altura de lo que se mueve no pasa el tope. Moverlo bajo el padre que ya tiene es válido (el caso de uso lo trata
 * como «ya estaba»).
 */
export function puedeMover(
  arbol: ArbolDeClasificacion,
  id: string,
  nuevoPadreId: string,
): Resultado<null, MotivoDeRechazoDeClasificacion> {
  const nodo = arbol.get(id);
  if (nodo === undefined) return err("NODO_INEXISTENTE");
  if (nodo.padreId === null) return err("DEPARTAMENTO_NO_SE_MUEVE");
  const padre = arbol.get(nuevoPadreId);
  if (padre === undefined) return err("PADRE_INEXISTENTE");
  if (!padre.activo) return err("PADRE_DESACTIVADO");
  const camino = caminoDeNodo(arbol, nuevoPadreId);
  if (!camino.ok) return err("ARBOL_INCONSISTENTE");
  if (camino.valor.includes(id)) return err("CICLO");
  const altura = alturaDelSubarbol(arbol, id);
  if (!altura.ok) return altura;
  return camino.valor.length + altura.valor > MAXIMO_DE_NIVELES_DE_CLASIFICACION
    ? err("TOPE_DE_NIVELES")
    : ok(null);
}

/** Los padres posibles de un nodo (lo que la pantalla deja elegir; el resto va apagado). Vacío si el nodo no se puede mover. */
export function destinosParaMover(arbol: ArbolDeClasificacion, id: string): ReadonlySet<string> {
  const destinos = new Set<string>();
  for (const candidato of arbol.keys()) {
    if (puedeMover(arbol, id, candidato).ok) destinos.add(candidato);
  }
  return destinos;
}

/** ¿Se puede desactivar? No con hijos activos («Primero desactivá lo que tiene adentro.»). */
export function puedeDesactivar(
  arbol: ArbolDeClasificacion,
  id: string,
): Resultado<null, MotivoDeRechazoDeClasificacion> {
  if (!arbol.has(id)) return err("NODO_INEXISTENTE");
  for (const nodo of arbol.values()) {
    if (nodo.padreId === id && nodo.activo) return err("TIENE_HIJOS_ACTIVOS");
  }
  return ok(null);
}

/** ¿Se puede reactivar? No si su padre está desactivado (no queda vivo lo que cuelga de algo desactivado). */
export function puedeReactivar(
  arbol: ArbolDeClasificacion,
  id: string,
): Resultado<null, MotivoDeRechazoDeClasificacion> {
  const nodo = arbol.get(id);
  if (nodo === undefined) return err("NODO_INEXISTENTE");
  if (nodo.padreId === null) return ok(null);
  const padre = arbol.get(nodo.padreId);
  if (padre === undefined) return err("ARBOL_INCONSISTENTE");
  return padre.activo ? ok(null) : err("PADRE_DESACTIVADO");
}
