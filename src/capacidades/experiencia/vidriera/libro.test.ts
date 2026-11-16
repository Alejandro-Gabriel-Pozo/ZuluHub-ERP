import { describe, expect, it } from "vitest";
import {
  acotarIndice,
  anclaDePagina,
  armarLibro,
  indiceDeAncla,
  moverse,
  navegacionEn,
  paginaEn,
} from "./libro";
import type { VistaDeProducto, VistaDeSeccion } from "./vista";

const producto = { nombre: "Café" } as VistaDeProducto;
const seccion = (id: string, nombre: string, cantidad = 1): VistaDeSeccion => ({
  id,
  nombre,
  productos: Array.from({ length: cantidad }, () => producto),
});
const tres = [
  seccion("entradas", "Entradas"),
  seccion("pastas", "Pastas"),
  seccion("postres", "Postres"),
];

describe("armarLibro", () => {
  it("lleva portada, índice y una página por sección, numeradas desde 1", () => {
    const libro = armarLibro(tres);
    expect(libro.paginas.map((p) => p.tipo)).toEqual([
      "PORTADA",
      "INDICE",
      "SECCION",
      "SECCION",
      "SECCION",
    ]);
    expect(libro.totalDeSecciones).toBe(3);
    expect(
      libro.paginas
        .filter((p) => p.tipo === "SECCION")
        .map((p) => (p as { numero: number }).numero),
    ).toEqual([1, 2, 3]);
  });

  it("una sección sin productos no existe: ni página ni número", () => {
    const libro = armarLibro([seccion("a", "A"), seccion("vacia", "Vacía", 0), seccion("b", "B")]);
    expect(libro.totalDeSecciones).toBe(2);
    expect(indiceDeAncla(libro, "vacia")).toBeNull();
    expect(navegacionEn(libro, 3).contador).toEqual({ numero: 2, total: 2 });
  });

  it("sin secciones queda solo portada e índice y nadie se pasa de largo", () => {
    const libro = armarLibro([]);
    expect(libro.paginas).toHaveLength(2);
    expect(moverse(libro, 1, 1)).toBe(1);
  });
});

describe("navegación", () => {
  const libro = armarLibro(tres);
  it("en la portada: sin atrás, sin botón Índice y sin contador", () => {
    expect(navegacionEn(libro, 0)).toEqual({
      puedeIrAtras: false,
      puedeIrAdelante: true,
      mostrarIndice: false,
      contador: null,
    });
  });
  it("en el índice: no cuenta como sección", () => {
    expect(navegacionEn(libro, 1)).toEqual({
      puedeIrAtras: true,
      puedeIrAdelante: true,
      mostrarIndice: false,
      contador: null,
    });
  });
  it("en una sección muestra «n de m» y el botón Índice; en la última no hay adelante", () => {
    expect(navegacionEn(libro, 2).contador).toEqual({ numero: 1, total: 3 });
    expect(navegacionEn(libro, 2).mostrarIndice).toBe(true);
    expect(navegacionEn(libro, 4)).toMatchObject({
      puedeIrAdelante: false,
      contador: { numero: 3, total: 3 },
    });
  });
  it("moverse no sale del libro y una posición rota vuelve a la portada", () => {
    expect(moverse(libro, 0, -1)).toBe(0);
    expect(moverse(libro, 4, 1)).toBe(4);
    expect(moverse(libro, 2, 1)).toBe(3);
    for (const rota of [-3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(acotarIndice(libro, rota)).toBe(0);
      expect(paginaEn(libro, rota).tipo).toBe("PORTADA");
    }
    expect(acotarIndice(libro, 99)).toBe(4);
  });
});

describe("anclas", () => {
  const libro = armarLibro(tres);
  it("un ancla de sección lleva a su página, con o sin #", () => {
    expect(indiceDeAncla(libro, "pastas")).toBe(3);
    expect(indiceDeAncla(libro, "#postres")).toBe(4);
  });
  it("un ancla desconocida o vacía no adivina: devuelve null", () => {
    for (const a of ["", "#", "nada", "pd-indice", "PASTAS"])
      expect(indiceDeAncla(libro, a)).toBeNull();
  });
  it("solo las secciones tienen fragmento, y es el que lleva de vuelta a ellas", () => {
    expect(anclaDePagina(paginaEn(libro, 0))).toBeNull();
    expect(anclaDePagina(paginaEn(libro, 1))).toBeNull();
    for (let i = 2; i < libro.paginas.length; i++) {
      expect(indiceDeAncla(libro, anclaDePagina(paginaEn(libro, i)) as string)).toBe(i);
    }
  });
});
