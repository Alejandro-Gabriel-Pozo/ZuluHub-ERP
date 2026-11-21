import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { formatearFecha } from "../../patrones/formato-fiscal";

/**
 * El modelo de vista de la clasificación comercial (A14; maqueta aprobada `clasificacion.html`, decisiones del dueño del 12/11 y 13/11/2026): de lo que entrega la composición, el árbol
 * de departamentos y categorías (cada nivel con su rótulo), lo que ofrecen las hojas «Mover» y «Cambiar» y la clasificación vigente de un producto en su ficha. Puro: sin React ni servidor.
 * Los textos salen del catálogo (`catalogo.clasificacion.*`, con su fuente en `catalogo-catalogo.ts`); no se arma ningún texto nuevo, solo se eligen los aprobados.
 *
 * Qué se ve (maqueta): el nivel 1 se llama «Departamento» y los niveles 2 a 4 «Categoría» (dueño, 13/11/2026); los hermanos van por orden alfabético (supuesto S4); un nodo desactivado se
 * marca «Desactivado». La pantalla NO decide qué se puede hacer con un nodo: lo que apaga (crear adentro, destinos de un movimiento) viene calculado por la composición con la misma
 * primitiva del servidor. Un departamento no se mueve (S3). Un nodo desactivado no se ofrece en la hoja «Cambiar» (S7) y el que ya tiene un producto se conserva a la vista.
 */

export const RUTA_DE_CLASIFICACION = "/catalogo/clasificacion";

/** El separador de un camino («Restaurante › Comidas»). */
const SEPARADOR = " › ";

/** Un nodo como lo entrega la composición (la misma forma, sin importar de dónde venga; la UI no importa los módulos). */
export type NodoDelArbol = Readonly<{
  id: string;
  padreId: string | null;
  nombre: string;
  activo: boolean;
  version: number;
  nivel: number;
  admiteHijos: boolean;
  destinos: readonly string[];
}>;

export type NodoArmado = Readonly<{
  id: string;
  padreId: string | null;
  nombre: string;
  /** El nombre con el nivel: «Departamento» o «Categoría». */
  rotulo: string;
  nivel: number;
  version: number;
  activo: boolean;
  /** «Desactivado» si lo está; `null` si no. */
  desactivado: string | null;
  tieneHijos: boolean;
  admiteHijos: boolean;
  /** Un departamento no se mueve. */
  seMueve: boolean;
  /** El camino del padre («Restaurante › Comidas»); vacío en un departamento. */
  caminoDelPadre: string;
  /** El camino propio, del departamento hasta el nodo («Restaurante › Comidas › Postres»). */
  camino: string;
  /** Los ids que pueden ser su nuevo padre (los apagados de la hoja «Mover» son todos los demás). */
  destinos: readonly string[];
}>;

export type ArbolArmado = Readonly<{
  titulo: string;
  crear: string;
  renombrar: string;
  /** El rótulo de lo que se crea en un departamento nuevo y adentro de un nodo. */
  rotuloDelDepartamento: string;
  rotuloDeLaCategoria: string;
  /** En orden de árbol: cada nodo seguido de sus hijos, los hermanos por nombre. */
  nodos: readonly NodoArmado[];
}>;

const rotuloDe = (nivel: number, d: DiccionarioResuelto): string =>
  texto(
    d,
    nivel === 1 ? "catalogo.clasificacion.departamento" : "catalogo.clasificacion.categoria",
  );

const porNombre = (a: Readonly<{ nombre: string }>, b: Readonly<{ nombre: string }>): number =>
  a.nombre.localeCompare(b.nombre, "es");

/** Los hijos de cada padre (`null` = los departamentos), por nombre. */
function hijosPorPadre<N extends Readonly<{ padreId: string | null; nombre: string }>>(
  nodos: readonly N[],
): ReadonlyMap<string | null, readonly N[]> {
  const mapa = new Map<string | null, N[]>();
  for (const n of nodos) mapa.set(n.padreId, [...(mapa.get(n.padreId) ?? []), n]);
  return new Map([...mapa].map(([padre, hijos]) => [padre, [...hijos].sort(porNombre)]));
}

/** Los nodos en orden de árbol: cada uno seguido de sus descendientes. Un nodo que no cuelga de ningún departamento (árbol dañado) no se dibuja: la composición ya lo rechazó. */
function enOrdenDeArbol<N extends Readonly<{ id: string; padreId: string | null; nombre: string }>>(
  nodos: readonly N[],
): readonly N[] {
  const hijos = hijosPorPadre(nodos);
  const salida: N[] = [];
  const recorrer = (padre: string | null): void => {
    for (const n of hijos.get(padre) ?? []) {
      salida.push(n);
      recorrer(n.id);
    }
  };
  recorrer(null);
  return salida;
}

/** Los nodos por id. La clave admite `null` (el padre de un departamento): buscarlo no da nada, sin un caso aparte. */
type PorId = ReadonlyMap<string | null, Readonly<{ padreId: string | null; nombre: string }>>;

const indexarPorId = <N extends Readonly<{ id: string; padreId: string | null; nombre: string }>>(
  nodos: readonly N[],
): ReadonlyMap<string | null, N> => new Map<string | null, N>(nodos.map((n) => [n.id, n]));

/** El camino de un nodo, del departamento hasta el propio nodo, con sus nombres. */
function caminoDe(porId: PorId, id: string | null): readonly string[] {
  const nombres: string[] = [];
  let actual = porId.get(id);
  while (actual !== undefined) {
    nombres.unshift(actual.nombre);
    actual = porId.get(actual.padreId);
  }
  return nombres;
}

export function armarElArbol(
  nodos: readonly NodoDelArbol[],
  d: DiccionarioResuelto = {},
): ArbolArmado {
  const porId = indexarPorId(nodos);
  const conHijos = new Set(nodos.map((n) => n.padreId));
  return {
    titulo: texto(d, "catalogo.clasificacion.titulo"),
    crear: texto(d, "catalogo.clasificacion.crear"),
    renombrar: texto(d, "catalogo.clasificacion.renombrar"),
    rotuloDelDepartamento: rotuloDe(1, d),
    rotuloDeLaCategoria: rotuloDe(2, d),
    nodos: enOrdenDeArbol(nodos).map((n) => ({
      id: n.id,
      padreId: n.padreId,
      nombre: n.nombre,
      rotulo: rotuloDe(n.nivel, d),
      nivel: n.nivel,
      version: n.version,
      activo: n.activo,
      desactivado: n.activo ? null : texto(d, "catalogo.estado.desactivado"),
      tieneHijos: conHijos.has(n.id),
      admiteHijos: n.admiteHijos,
      seMueve: n.nivel > 1,
      caminoDelPadre: caminoDe(porId, n.padreId).join(SEPARADOR),
      camino: caminoDe(porId, n.id).join(SEPARADOR),
      destinos: n.destinos,
    })),
  };
}

/** Los nodos que se ven con lo plegado: un nodo se ve si ninguno de sus ascendientes está plegado (el árbol arranca desplegado entero). */
export function nodosVisibles(
  nodos: readonly NodoArmado[],
  plegados: ReadonlySet<string>,
): readonly NodoArmado[] {
  const porId = indexarPorId(nodos);
  const visible = (n: NodoArmado): boolean => {
    const padre = porId.get(n.padreId);
    return padre === undefined || (!plegados.has(padre.id) && visible(padre));
  };
  return nodos.filter(visible);
}

export type OpcionDeDestino = Readonly<{ valor: string; etiqueta: string; apagada: boolean }>;

/** La lista de «Mover»: todo el árbol, cada nodo con su camino; el propio nodo, sus descendientes, lo que pasaría el tope y lo desactivado van apagados (S1: apagados, no ocultos). */
export function opcionesDeMover(
  nodos: readonly NodoArmado[],
  nodoId: string,
): readonly OpcionDeDestino[] {
  const porId = indexarPorId(nodos);
  const permitidos = new Set(porId.get(nodoId)?.destinos);
  return nodos.map((n) => ({
    valor: n.id,
    etiqueta: caminoDe(porId, n.id).join(SEPARADOR),
    apagada: !permitidos.has(n.id),
  }));
}

/* ---------- la clasificación de un producto, en su ficha ---------- */

export type NodoParaElegir = Readonly<{ id: string; padreId: string | null; nombre: string }>;

/** La clasificación de un producto como la entrega la composición. */
export type ClasificacionDelProducto = Readonly<{
  productoId: string;
  vigente: Readonly<{
    desde: string;
    camino: readonly Readonly<{ id: string; nombre: string; activo: boolean }>[];
  }> | null;
  nodos: readonly NodoParaElegir[];
}>;

export type ClasificacionDelProductoArmada = Readonly<{
  productoId: string;
  /** Una fila por nivel del camino vigente; sin camino, una sola: «Departamento: Sin elegir». El nombre accesible de las categorías lleva su padre («Categoría de Restaurante»). */
  filas: readonly Readonly<{
    rotulo: string;
    valor: string;
    nombreAccesible: string | undefined;
  }>[];
  /** «Desactivado» si el último nodo del camino lo está; `null` si no. */
  desactivado: string | null;
  /** «Vigente desde dd/mm/aaaa»; `null` si nunca se clasificó. */
  vigenteDesde: Readonly<{ rotulo: string; valor: string }> | null;
  cambiar: string;
  /** Sin departamentos cargados no hay qué elegir: «Cambiar» sale apagado. */
  hayQueElegir: boolean;
  /** El nodo que rige hoy (`null` = «Sin elegir»). */
  nodoVigente: string | null;
  /** Lo que arranca elegido en la hoja: el camino vigente sin los nodos desactivados. */
  seleccionInicial: readonly string[];
  /** Los nodos activos que se pueden elegir. */
  nodos: readonly NodoParaElegir[];
  sinElegir: string;
  guardar: string;
  cancelar: string;
}>;

export function armarLaClasificacionDelProducto(
  c: ClasificacionDelProducto,
  d: DiccionarioResuelto = {},
): ClasificacionDelProductoArmada {
  const camino = c.vigente === null ? [] : c.vigente.camino;
  const sinElegir = texto(d, "catalogo.dato.sin_elegir");
  const ultimo = camino.at(-1);
  return {
    productoId: c.productoId,
    filas:
      camino.length === 0
        ? [{ rotulo: rotuloDe(1, d), valor: sinElegir, nombreAccesible: undefined }]
        : camino.map((n, i) => ({
            rotulo: rotuloDe(i + 1, d),
            valor: n.nombre,
            nombreAccesible: nombreAccesibleDe(camino[i - 1]?.nombre, d),
          })),
    desactivado:
      ultimo !== undefined && !ultimo.activo ? texto(d, "catalogo.estado.desactivado") : null,
    vigenteDesde:
      c.vigente === null
        ? null
        : {
            rotulo: texto(d, "catalogo.precio.vigente_desde"),
            valor: formatearFecha(c.vigente.desde),
          },
    cambiar: texto(d, "catalogo.clasificacion.cambiar"),
    hayQueElegir: c.nodos.length > 0,
    nodoVigente: ultimo === undefined ? null : ultimo.id,
    seleccionInicial: camino.filter((n) => n.activo).map((n) => n.id),
    nodos: c.nodos,
    sinElegir,
    guardar: texto(d, "catalogo.accion.guardar"),
    cancelar: texto(d, "catalogo.accion.cancelar"),
  };
}

/** «Categoría de {padre}» para un nivel que tiene padre; el departamento no lo lleva (su rótulo ya alcanza). */
const nombreAccesibleDe = (
  padre: string | undefined,
  d: DiccionarioResuelto,
): string | undefined =>
  padre === undefined ? undefined : texto(d, "catalogo.clasificacion.categoria_de", { padre });

export type SelectorDeNivel = Readonly<{
  nivel: number;
  rotulo: string;
  /** Solo lector de pantalla: «Categoría de Restaurante»; `undefined` en el primer nivel. */
  nombreAccesible: string | undefined;
  /** El nodo elegido en este nivel (`""` = «Sin elegir»). */
  valor: string;
  opciones: readonly Readonly<{ valor: string; etiqueta: string }>[];
}>;

/**
 * Los selectores encadenados de la hoja «Cambiar» (decisión del dueño, 12/11/2026: un desplegable por nivel): el primero ofrece los departamentos; cada siguiente aparece solo si el
 * anterior tiene algo elegido y ese nodo tiene hijos. `seleccion` es lo elegido de arriba hacia abajo; lo que ya no cuelga de lo elegido arriba se descarta.
 */
export function selectoresDeNivel(
  nodos: readonly NodoParaElegir[],
  seleccion: readonly string[],
  d: DiccionarioResuelto = {},
): readonly SelectorDeNivel[] {
  const hijos = hijosPorPadre(nodos);
  const salida: SelectorDeNivel[] = [];
  let padre: string | null = null;
  let nombreDelPadre: string | undefined;
  for (let nivel = 1; ; nivel += 1) {
    const ofrecidos: readonly NodoParaElegir[] = hijos.get(padre) ?? [];
    if (ofrecidos.length === 0) break;
    const elegido = ofrecidos.find((n) => n.id === seleccion[nivel - 1]);
    salida.push({
      nivel,
      rotulo: rotuloDe(nivel, d),
      nombreAccesible: nombreAccesibleDe(nombreDelPadre, d),
      valor: elegido === undefined ? "" : elegido.id,
      opciones: ofrecidos.map((n) => ({ valor: n.id, etiqueta: n.nombre })),
    });
    if (elegido === undefined) break;
    padre = elegido.id;
    nombreDelPadre = elegido.nombre;
  }
  return salida;
}

/** Lo elegido, de arriba hacia abajo, hasta el último nivel con algo elegido (lo de abajo de un «Sin elegir» no cuenta). */
export function seleccionVigente(
  nodos: readonly NodoParaElegir[],
  seleccion: readonly string[],
): readonly string[] {
  return selectoresDeNivel(nodos, seleccion)
    .map((s) => s.valor)
    .filter((v) => v !== "");
}

/** Elige `valor` en el nivel `nivel` (`""` = «Sin elegir») y descarta lo que estaba más abajo. */
export function elegirEnElNivel(
  seleccion: readonly string[],
  nivel: number,
  valor: string,
): readonly string[] {
  const arriba = seleccion.slice(0, nivel - 1);
  return valor === "" ? arriba : [...arriba, valor];
}

/** El nodo que queda elegido (`null` = «Sin elegir»). */
export const nodoElegido = (seleccion: readonly string[]): string | null =>
  seleccion.at(-1) ?? null;
