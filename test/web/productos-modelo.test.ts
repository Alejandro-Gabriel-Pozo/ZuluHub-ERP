import { describe, expect, it } from "vitest";
import { ESTADOS_DE_PRODUCTO } from "../../src/composicion/entradas-de-productos";
import { CLASES_DE_USO } from "../../src/modulos/catalogo/publico";
import {
  CLASES_DEL_FILTRO,
  ESTADOS_DEL_FILTRO,
  FILTROS_POR_DEFECTO,
  RUTA_DE_PRODUCTOS,
  armarLosFiltros,
  direccionDeLaLista,
  leerLaPagina,
  leerLosFiltros,
} from "../../apps/web/ui/plantillas/catalogo/filtros-de-productos";
import {
  armarLaLista,
  type PaginaDeLaLista,
  type ProductoDeLaLista,
} from "../../apps/web/ui/plantillas/catalogo/modelo-de-productos";

/**
 * El modelo de vista de la lista de productos (A1, T1; maqueta `productos.html`, 12/11/2026), con los textos reales del catálogo: cada fila dice lo que la maqueta dice, los
 * filtros se leen de la dirección y vuelven a ella. Previene: una clase o un estado nuevo en el módulo sin su texto en la pantalla.
 */
const producto = (cambios: Partial<ProductoDeLaLista> = {}): ProductoDeLaLista => ({
  id: "p1",
  nombre: "Milanesa",
  claseDeUso: "VENDIBLE",
  estado: "ACTIVO",
  precio: { tipo: "EMPRESA", importe: "9000.00" },
  ...cambios,
});
const pagina = (
  productos: readonly ProductoDeLaLista[],
  siguiente: string | null = null,
): PaginaDeLaLista => ({
  productos,
  siguiente,
});
const fila = (p: ProductoDeLaLista) => {
  const [f] = armarLaLista(pagina([p]), FILTROS_POR_DEFECTO).filas;
  if (f === undefined) throw new Error("se esperaba una fila");
  return f;
};

describe("las listas de la pantalla coinciden con las del módulo y de la composición", () => {
  it("las clases: las mismas cinco, en el mismo orden", () => {
    expect([...CLASES_DEL_FILTRO]).toEqual([...CLASES_DE_USO]);
  });
  it("los estados: los mismos tres, en el mismo orden", () => {
    expect([...ESTADOS_DEL_FILTRO]).toEqual([...ESTADOS_DE_PRODUCTO]);
  });
});

describe("armarLaLista: la fila", () => {
  it("un producto activo y completo no lleva marca; dice su nombre, su clase y su precio con el formato es-AR", () => {
    expect(fila(producto())).toEqual({
      id: "p1",
      nombre: "Milanesa",
      marca: null,
      clase: "Producto vendible",
      precio: "$ 9.000,00",
    });
  });

  it("falta completar y desactivado llevan su marca en tono de aviso", () => {
    expect(fila(producto({ estado: "FALTA_COMPLETAR" })).marca).toEqual({
      texto: "Falta completar",
      tono: "aviso",
    });
    expect(fila(producto({ estado: "DESACTIVADO" })).marca).toEqual({
      texto: "Desactivado",
      tono: "aviso",
    });
  });

  it("un estado que la pantalla no conoce se dice con su propio valor (no se esconde)", () => {
    expect(fila(producto({ estado: "EN_REVISION" })).marca).toEqual({
      texto: "EN_REVISION",
      tono: "aviso",
    });
    expect(fila(producto({ estado: "toString" })).marca).toEqual({
      texto: "toString",
      tono: "aviso",
    });
  });

  it.each([
    ["MATERIA_PRIMA", "Materia prima"],
    ["INSUMO", "Insumo"],
    ["REVENTA", "Reventa"],
    ["ELABORADO", "Elaborado"],
    ["VENDIBLE", "Producto vendible"],
  ])("la clase %s se dice «%s»", (claseDeUso, esperado) => {
    expect(fila(producto({ claseDeUso })).clase).toBe(esperado);
  });

  it("una clase que la pantalla no conoce se dice con su propio valor", () => {
    expect(fila(producto({ claseDeUso: "SERVICIO" })).clase).toBe("SERVICIO");
    expect(fila(producto({ claseDeUso: "constructor" })).clase).toBe("constructor");
  });

  it("el precio: importe formateado, «Según medida», «Sin precio» o nada si no se vende", () => {
    expect(fila(producto({ precio: { tipo: "EMPRESA", importe: "1234567.5" } })).precio).toBe(
      "$ 1.234.567,50",
    );
    expect(fila(producto({ precio: { tipo: "SEGUN_TAMANO" } })).precio).toBe("Según medida");
    expect(fila(producto({ precio: { tipo: "SIN_PRECIO" } })).precio).toBe("Sin precio");
    expect(fila(producto({ precio: null })).precio).toBeNull();
  });

  it("el importe queda como texto: un importe enorme no pierde cifras", () => {
    expect(
      fila(producto({ precio: { tipo: "EMPRESA", importe: "12345678901234567890.12" } })).precio,
    ).toBe("$ 12.345.678.901.234.567.890,12");
  });

  it("nada de más: la fila tiene solo id, nombre, marca, clase y precio", () => {
    expect(Object.keys(fila(producto())).sort()).toEqual([
      "clase",
      "id",
      "marca",
      "nombre",
      "precio",
    ]);
  });

  it("sin productos, sin filas y sin «Página siguiente»", () => {
    expect(armarLaLista(pagina([]), FILTROS_POR_DEFECTO)).toEqual({ filas: [], siguiente: null });
  });

  it("«Página siguiente» lleva a la dirección con los mismos filtros y la clave de la consulta", () => {
    const lista = armarLaLista(pagina([producto()], "abc:harina"), {
      texto: "ha",
      clase: "INSUMO",
      estado: "ACTIVO",
    });
    expect(lista.siguiente?.texto).toBe("Página siguiente");
    expect(lista.siguiente?.href).toBe(
      `${RUTA_DE_PRODUCTOS}?texto=ha&clase=INSUMO&estado=ACTIVO&despues=abc%3Aharina`,
    );
  });
});

describe("leerLosFiltros", () => {
  it("sin nada en la dirección, todos", () => {
    expect(leerLosFiltros({})).toEqual(FILTROS_POR_DEFECTO);
  });

  it("lee texto, clase y estado; recorta el texto", () => {
    expect(leerLosFiltros({ texto: "  mila ", clase: "VENDIBLE", estado: "DESACTIVADO" })).toEqual({
      texto: "mila",
      clase: "VENDIBLE",
      estado: "DESACTIVADO",
    });
  });

  it("una clase o un estado que no es una opción vuelve a «Todos»", () => {
    expect(leerLosFiltros({ clase: "SERVICIO", estado: "BORRADO" })).toEqual(FILTROS_POR_DEFECTO);
    expect(leerLosFiltros({ clase: "vendible", estado: "activo" })).toEqual(FILTROS_POR_DEFECTO);
  });

  it("si un parámetro viene repetido, vale el primero", () => {
    expect(leerLosFiltros({ texto: ["uno", "dos"], clase: ["INSUMO", "VENDIBLE"] })).toEqual({
      texto: "uno",
      clase: "INSUMO",
      estado: "",
    });
  });

  it("la página es la clave tal cual; sin ella, vacía", () => {
    expect(leerLaPagina({})).toBe("");
    expect(leerLaPagina({ despues: "abc:harina" })).toBe("abc:harina");
    expect(leerLaPagina({ despues: ["uno", "dos"] })).toBe("uno");
  });
});

describe("direccionDeLaLista", () => {
  it("la lista vive en /catalogo/productos", () => {
    expect(RUTA_DE_PRODUCTOS).toBe("/catalogo/productos");
  });
  it("sin filtros ni página, la lista a secas", () => {
    expect(direccionDeLaLista(FILTROS_POR_DEFECTO, null)).toBe(RUTA_DE_PRODUCTOS);
  });
  it("solo lleva lo que se aparta de «Todos» y escapa lo escrito", () => {
    expect(direccionDeLaLista({ texto: "a&b c", clase: "", estado: "ACTIVO" }, null)).toBe(
      `${RUTA_DE_PRODUCTOS}?texto=a%26b+c&estado=ACTIVO`,
    );
  });
  it("lleva la página si hay", () => {
    expect(direccionDeLaLista(FILTROS_POR_DEFECTO, "x:y")).toBe(
      `${RUTA_DE_PRODUCTOS}?despues=x%3Ay`,
    );
  });
  it("lo que se escribe vuelve igual al leerlo de la dirección", () => {
    const filtros = { texto: "café & té", clase: "REVENTA", estado: "FALTA_COMPLETAR" } as const;
    const url = new URL(direccionDeLaLista(filtros, null), "http://x");
    expect(leerLosFiltros(Object.fromEntries(url.searchParams))).toEqual(filtros);
  });
});

describe("armarLosFiltros: los textos del formulario", () => {
  const f = armarLosFiltros({ texto: "mila", clase: "VENDIBLE", estado: "" });
  it("rótulos y botón: los aprobados", () => {
    expect(f.accion).toBe(RUTA_DE_PRODUCTOS);
    expect(f.textos).toEqual({
      buscar: "Buscar",
      clase: "¿Qué es?",
      estado: "Estado",
      todos: "Todos",
      aplicar: "Aplicar filtros",
    });
    expect(f.valores).toEqual({ texto: "mila", clase: "VENDIBLE", estado: "" });
  });
  it("las opciones, en el orden de la maqueta", () => {
    expect(f.clases).toEqual([
      { valor: "MATERIA_PRIMA", etiqueta: "Materia prima" },
      { valor: "INSUMO", etiqueta: "Insumo" },
      { valor: "REVENTA", etiqueta: "Reventa" },
      { valor: "ELABORADO", etiqueta: "Elaborado" },
      { valor: "VENDIBLE", etiqueta: "Producto vendible" },
    ]);
    expect(f.estados).toEqual([
      { valor: "ACTIVO", etiqueta: "Activo" },
      { valor: "FALTA_COMPLETAR", etiqueta: "Falta completar" },
      { valor: "DESACTIVADO", etiqueta: "Desactivado" },
    ]);
  });
});
