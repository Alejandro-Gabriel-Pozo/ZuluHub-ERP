import type { VistaDeSeccion } from "./vista";

/**
 * El modelo Libro de la carta, como datos puros (carta-libro-especificacion §4 y §6): qué páginas tiene, qué
 * contador y qué flechas corresponden a cada una y cómo se vuelve de un ancla a su página. Es una CAPA sobre la
 * misma `VistaDeVidriera` de la Lista: no pide nada a la base y no repite ninguna regla de lectura de productos
 * (precios, medidas, guarnición). Sin reloj, sin azar, sin DOM: lo que se equivoca con un dato se prueba acá.
 *
 * Previene: un contador que cuenta la portada o el índice («Sección 3 de 13» en la página 2), una sección sin
 * productos que aparece en el índice y lleva a una página vacía, y un enlace `#ancla` desconocido que rompe el
 * libro en vez de abrir la portada (fail closed).
 */

export type PaginaDelLibro =
  | Readonly<{ tipo: "PORTADA" }>
  | Readonly<{ tipo: "INDICE" }>
  | Readonly<{
      tipo: "SECCION";
      /** El ancla de la sección en la Lista (`#<slug>`): es también su dirección dentro del libro. */
      id: string;
      nombre: string;
      /** Número de la sección, desde 1: no cuenta la portada ni el índice. */
      numero: number;
    }>;

export type Libro = Readonly<{
  paginas: readonly PaginaDelLibro[];
  /** Cantidad de secciones (con productos): el «m» de «Sección n de m». */
  totalDeSecciones: number;
}>;

export const INDICE_DE_LA_PORTADA = 0;
export const INDICE_DEL_INDICE = 1;

/**
 * Portada, índice y una página por sección. Una sección sin productos no existe (ni en el índice ni en el
 * contador), igual que en la búsqueda de la Lista (`filtrarSecciones`).
 */
export function armarLibro(secciones: readonly VistaDeSeccion[]): Libro {
  const conProductos = secciones.filter((s) => s.productos.length > 0);
  return {
    paginas: [
      { tipo: "PORTADA" },
      { tipo: "INDICE" },
      ...conProductos.map((s, i): PaginaDelLibro => ({
        tipo: "SECCION",
        id: s.id,
        nombre: s.nombre,
        numero: i + 1,
      })),
    ],
    totalDeSecciones: conProductos.length,
  };
}

/** La página en esa posición, o la portada si la posición no existe (nunca «ninguna página»). */
export function paginaEn(libro: Libro, indice: number): PaginaDelLibro {
  return (
    libro.paginas[Number.isInteger(indice) ? indice : INDICE_DE_LA_PORTADA] ?? libro.paginas[0]!
  );
}

/** Deja la posición dentro del libro; lo que no es un entero válido vuelve a la portada. */
export function acotarIndice(libro: Libro, indice: number): number {
  if (!Number.isInteger(indice) || indice < 0) return INDICE_DE_LA_PORTADA;
  return Math.min(indice, libro.paginas.length - 1);
}

/** La posición de la sección con ese ancla; `null` si no es una sección de este libro (nunca adivina). */
export function indiceDeAncla(libro: Libro, ancla: string): number | null {
  const sinNumeral = ancla.startsWith("#") ? ancla.slice(1) : ancla;
  const posicion = libro.paginas.findIndex((p) => p.tipo === "SECCION" && p.id === sinNumeral);
  return posicion === -1 ? null : posicion;
}

/** El fragmento de la dirección para una página: solo las secciones tienen uno (la portada y el índice, no). */
export function anclaDePagina(pagina: PaginaDelLibro): string | null {
  return pagina.tipo === "SECCION" ? pagina.id : null;
}

export type NavegacionDelLibro = Readonly<{
  puedeIrAtras: boolean;
  puedeIrAdelante: boolean;
  /** El botón «Índice» del centro: solo dentro de una sección (en la portada y en el índice no hace falta). */
  mostrarIndice: boolean;
  /** «n» y «m» del contador; `null` fuera de las secciones. */
  contador: Readonly<{ numero: number; total: number }> | null;
}>;

/** Lo que muestran las flechas, el botón central y el contador en una posición. */
export function navegacionEn(libro: Libro, indice: number): NavegacionDelLibro {
  const actual = acotarIndice(libro, indice);
  const pagina = paginaEn(libro, actual);
  return {
    puedeIrAtras: actual > 0,
    puedeIrAdelante: actual < libro.paginas.length - 1,
    mostrarIndice: pagina.tipo === "SECCION",
    contador:
      pagina.tipo === "SECCION" ? { numero: pagina.numero, total: libro.totalDeSecciones } : null,
  };
}

/** Un paso (+1 o −1) sin salirse del libro: en los extremos se queda donde está. */
export function moverse(libro: Libro, indice: number, paso: 1 | -1): number {
  return acotarIndice(libro, acotarIndice(libro, indice) + paso);
}
