/**
 * Cuándo el navegador monta la capa Libro sobre la Lista (03 §4.4, dueño 13/10/2026) y qué página muestra cada
 * posición de la pista horizontal. Todo es puro: el componente solo le pasa lo que mide.
 */

/** Si el script llega después de esto, la carta se queda en Lista: transformar la página mientras se lee es peor que no hacerlo. */
export const MS_MAXIMOS_PARA_MONTAR_EL_LIBRO = 2500;

/** Tipos de red (`navigator.connection.effectiveType`) con los que la carta no se transforma. */
const REDES_LENTAS: ReadonlySet<string> = new Set(["slow-2g", "2g"]);

export type EntornoDelLibro = Readonly<{
  /** Milisegundos desde que arrancó la navegación hasta que el script del Libro corrió (`performance.now()`). */
  msHastaElScript: number;
  /** `navigator.connection.saveData`, o `false` si el navegador no lo informa. */
  ahorroDeDatos: boolean;
  /** `navigator.connection.effectiveType`, o `null` si el navegador no lo informa. */
  tipoDeRed: string | null;
  /** `prefers-reduced-motion: reduce`. */
  movimientoReducido: boolean;
}>;

/** Todo lo que no se pudo medir cuenta como «no se puede»: ante la duda la carta queda en Lista (fail closed). */
export function puedeMontarseElLibro(entorno: EntornoDelLibro): boolean {
  if (!Number.isFinite(entorno.msHastaElScript)) return false;
  if (entorno.msHastaElScript > MS_MAXIMOS_PARA_MONTAR_EL_LIBRO) return false;
  if (entorno.ahorroDeDatos || entorno.movimientoReducido) return false;
  return entorno.tipoDeRed === null || !REDES_LENTAS.has(entorno.tipoDeRed);
}

/** Las páginas del Libro, en orden: portada, índice y una por sección. */
export const PAGINA_PORTADA = 0;
export const PAGINA_INDICE = 1;
const PAGINAS_ANTES_DE_LAS_SECCIONES = 2;

/** La página de la sección `i` (empezando en 0). */
export function paginaDeLaSeccion(i: number): number {
  return PAGINAS_ANTES_DE_LAS_SECCIONES + i;
}

/** La página que muestra un desplazamiento horizontal: la más cercana, acotada a las que existen. */
export function paginaVisible(
  desplazamiento: number,
  anchoDePagina: number,
  paginas: number,
): number {
  if (paginas <= 0 || !(anchoDePagina > 0) || !Number.isFinite(desplazamiento))
    return PAGINA_PORTADA;
  return Math.min(paginas - 1, Math.max(0, Math.round(desplazamiento / anchoDePagina)));
}

/** El número de sección (desde 1) que se muestra en el contador, o `null` en la portada y el índice. */
export function numeroDeSeccion(pagina: number): number | null {
  return pagina < PAGINAS_ANTES_DE_LAS_SECCIONES
    ? null
    : pagina - PAGINAS_ANTES_DE_LAS_SECCIONES + 1;
}

/** La página a la que lleva `#<slug>`: la de esa sección, o `null` si ninguna sección tiene ese ancla. */
export function paginaDelAncla(ancla: string, idsDeSecciones: readonly string[]): number | null {
  const sinNumeral = ancla.startsWith("#") ? ancla.slice(1) : ancla;
  let id = sinNumeral;
  try {
    id = decodeURIComponent(sinNumeral);
  } catch {
    return null;
  }
  const i = idsDeSecciones.indexOf(id);
  return i === -1 ? null : paginaDeLaSeccion(i);
}

/** La página vecina (`+1` siguiente, `-1` anterior), sin salirse de la primera ni de la última. */
export function paginaVecina(actual: number, paso: 1 | -1, paginas: number): number {
  return Math.min(paginas - 1, Math.max(0, actual + paso));
}
