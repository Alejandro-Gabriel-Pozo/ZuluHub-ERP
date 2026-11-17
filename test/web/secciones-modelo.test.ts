import { describe, expect, it } from "vitest";
import {
  CAMPO_DE_BAJAR,
  CAMPO_DE_SUBIR,
  RUTA_DE_LA_SECCION_NUEVA,
  RUTA_DE_SECCIONES,
  armarElFormularioDeSeccion,
  armarLaListaDeSecciones,
  armarUnaSeccion,
  rutaDeLaSeccion,
  rutaDelNombreDeLaSeccion,
  sePuedeGuardarElNombre,
  type SeccionDeLaLista,
  type UnaSeccionDeLaPantalla,
} from "../../apps/web/ui/plantillas/catalogo/modelo-de-secciones";

/**
 * El modelo de vista de «Secciones de la carta» (A8, parte 1; maqueta `productos-secciones.html`), con los textos reales del catálogo: el orden de la lista (activas primero, desactivadas al
 * final sin flechas), qué flechas salen apagadas, qué se ofrece sin permiso, lo que viaja ligado a la acción, la página de una sección y el formulario del nombre.
 */
const A = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const B = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const C = "7d2e1f00-1111-4222-8333-944455556666";
const D = "9a8b7c6d-1111-4222-8333-944455556666";

const CAFES: SeccionDeLaLista = { id: A, nombre: "Cafés", activa: true, version: 3 };
const POSTRES: SeccionDeLaLista = { id: B, nombre: "Postres", activa: false, version: 1 };
const BEBIDAS: SeccionDeLaLista = { id: C, nombre: "Bebidas", activa: true, version: 5 };
const COMER: SeccionDeLaLista = { id: D, nombre: "Para comer", activa: true, version: 2 };

describe("las direcciones", () => {
  it("siguen el patrón de /catalogo/productos", () => {
    expect(RUTA_DE_SECCIONES).toBe("/catalogo/secciones");
    expect(RUTA_DE_LA_SECCION_NUEVA).toBe("/catalogo/secciones/nueva");
    expect(rutaDeLaSeccion(A)).toBe(`/catalogo/secciones/${A}`);
    expect(rutaDelNombreDeLaSeccion(A)).toBe(`/catalogo/secciones/${A}/nombre`);
  });

  it("las flechas viajan con los nombres que lee la acción", () => {
    expect([CAMPO_DE_SUBIR, CAMPO_DE_BAJAR]).toEqual(["subir", "bajar"]);
  });
});

describe("armarLaListaDeSecciones", () => {
  const lista = armarLaListaDeSecciones([CAFES, POSTRES, BEBIDAS, COMER], true);

  it("las activas van primero en el orden que viene, y las desactivadas al final, sin importar dónde estaban", () => {
    expect(lista.filas.map((f) => f.nombre)).toEqual(["Cafés", "Bebidas", "Para comer", "Postres"]);
  });

  it("cada fila lleva el enlace a su sección; las desactivadas, la marca «Desactivado»", () => {
    expect(lista.filas.map((f) => [f.id, f.href, f.marca])).toEqual([
      [A, `/catalogo/secciones/${A}`, null],
      [C, `/catalogo/secciones/${C}`, null],
      [D, `/catalogo/secciones/${D}`, null],
      [B, `/catalogo/secciones/${B}`, "Desactivado"],
    ]);
  });

  it("las flechas de las activas se nombran con la sección, y las desactivadas no tienen", () => {
    expect(lista.filas[0]?.flechas?.subir.etiqueta).toBe("Subir Cafés");
    expect(lista.filas[0]?.flechas?.bajar.etiqueta).toBe("Bajar Cafés");
    expect(lista.filas[1]?.flechas?.subir.etiqueta).toBe("Subir Bebidas");
    expect(lista.filas[3]?.flechas).toBeNull();
  });

  it("cada flecha viaja con su nombre de campo", () => {
    expect(lista.filas[1]?.flechas?.subir.campo).toBe("subir");
    expect(lista.filas[1]?.flechas?.bajar.campo).toBe("bajar");
  });

  it("la primera activa no sube y la última activa no baja (la desactivada del final no cuenta); las del medio, sí", () => {
    expect(
      lista.filas.slice(0, 3).map((f) => [f.flechas?.subir.apagada, f.flechas?.bajar.apagada]),
    ).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);
  });

  it("una sola activa no se mueve; una carta sin activas no tiene flechas", () => {
    const sola = armarLaListaDeSecciones([POSTRES, CAFES], true);
    expect([sola.filas[0]?.flechas?.subir.apagada, sola.filas[0]?.flechas?.bajar.apagada]).toEqual([
      true,
      true,
    ]);
    const ninguna = armarLaListaDeSecciones([POSTRES], true);
    expect(ninguna.filas.map((f) => f.flechas)).toEqual([null]);
    expect(ninguna.vistas).toEqual([]);
  });

  it("lo que la persona vio: las activas en el orden en que se ven, cada una con su versión (sin las desactivadas)", () => {
    expect(lista.vistas).toEqual([
      { seccionId: A, versionEsperada: 3 },
      { seccionId: C, versionEsperada: 5 },
      { seccionId: D, versionEsperada: 2 },
    ]);
  });

  it("con permiso sale «Nueva sección»", () => {
    expect(lista.nueva).toEqual({ href: "/catalogo/secciones/nueva", texto: "Nueva sección" });
  });

  it.each([false, undefined])(
    "sin permiso (%s) no sale «Nueva sección» y todas las flechas salen apagadas, pero se ve todo",
    (puede) => {
      const sin = armarLaListaDeSecciones([CAFES, POSTRES, BEBIDAS], puede);
      expect(sin.nueva).toBeNull();
      expect(sin.filas.map((f) => f.nombre)).toEqual(["Cafés", "Bebidas", "Postres"]);
      expect(
        sin.filas.flatMap((f) => [f.flechas?.subir.apagada, f.flechas?.bajar.apagada]),
      ).toEqual([true, true, true, true, undefined, undefined]);
    },
  );

  it("sin secciones: ninguna fila, nada ligado, y «Nueva sección» con permiso", () => {
    const vacia = armarLaListaDeSecciones([], true);
    expect(vacia.filas).toEqual([]);
    expect(vacia.vistas).toEqual([]);
    expect(vacia.nueva).not.toBeNull();
  });

  it("usa el diccionario si se lo dan", () => {
    const propia = armarLaListaDeSecciones([CAFES, POSTRES], true, {
      "catalogo.estado.desactivado": "Apagada",
      "catalogo.seccion.nueva": "Crear",
    });
    expect(propia.filas[1]?.marca).toBe("Apagada");
    expect(propia.nueva?.texto).toBe("Crear");
  });
});

describe("armarUnaSeccion", () => {
  const productos = [
    { id: "p1", nombre: "Cortado" },
    { id: "p2", nombre: "Espresso" },
  ];
  const dato = (
    seccion: SeccionDeLaLista,
    siguiente: string | null = null,
  ): UnaSeccionDeLaPantalla => ({
    seccion,
    productos,
    siguiente,
  });

  it("una sección activa: su nombre de título, vuelta a la lista, «Nombre», «Desactivar» y sus productos", () => {
    const s = armarUnaSeccion(dato(CAFES), true);
    expect(s).toEqual({
      id: A,
      titulo: "Cafés",
      volver: { href: "/catalogo/secciones", etiqueta: "Volver a la lista" },
      marca: null,
      nombre: { texto: "Nombre", href: `/catalogo/secciones/${A}/nombre` },
      estado: { reactivar: false, texto: "Desactivar", apagado: false },
      productos,
      siguiente: null,
    });
  });

  it("una sección desactivada: la marca «Desactivado» y «Reactivar»", () => {
    const s = armarUnaSeccion(dato(POSTRES), true);
    expect(s.marca).toBe("Desactivado");
    expect(s.estado).toEqual({ reactivar: true, texto: "Reactivar", apagado: false });
  });

  it.each([false, undefined])(
    "sin permiso (%s): «Nombre» sin enlace y «Desactivar» apagado, pero se ve todo",
    (puede) => {
      const s = armarUnaSeccion(dato(CAFES), puede);
      expect(s.nombre).toEqual({ texto: "Nombre", href: null });
      expect(s.estado.apagado).toBe(true);
      expect(s.productos).toEqual(productos);
    },
  );

  it("si hay otra página, «Página siguiente» lleva a la dirección de la sección con la clave de la página", () => {
    const s = armarUnaSeccion(dato(CAFES, `${B}:espresso`), true);
    expect(s.siguiente).toEqual({
      href: `/catalogo/secciones/${A}?despues=${encodeURIComponent(`${B}:espresso`)}`,
      texto: "Página siguiente",
    });
  });

  it("una sección sin productos no dice nada", () => {
    const s = armarUnaSeccion({ seccion: CAFES, productos: [], siguiente: null }, true);
    expect(s.productos).toEqual([]);
  });

  it("usa el diccionario si se lo dan", () => {
    const s = armarUnaSeccion(dato(CAFES), true, {
      "catalogo.accion.desactivar": "Apagar",
      "catalogo.seccion.volver_a_la_lista": "Atrás",
    });
    expect(s.estado.texto).toBe("Apagar");
    expect(s.volver.etiqueta).toBe("Atrás");
  });
});

describe("el formulario del nombre", () => {
  it("una sección nueva abre vacía; renombrar, con el nombre actual", () => {
    expect(armarElFormularioDeSeccion(null, true).nombre).toEqual({
      etiqueta: "Nombre",
      valorInicial: "",
    });
    expect(armarElFormularioDeSeccion({ nombre: "Cafés" }, true).nombre).toEqual({
      etiqueta: "Nombre",
      valorInicial: "Cafés",
    });
  });

  it("«Guardar», «Cancelar» (a la lista) y la vuelta a la lista son los textos aprobados", () => {
    const f = armarElFormularioDeSeccion(null, true);
    expect(f.guardar).toBe("Guardar");
    expect(f.cancelar).toEqual({ href: "/catalogo/secciones", texto: "Cancelar" });
    expect(f.volver).toEqual({ href: "/catalogo/secciones", etiqueta: "Volver a la lista" });
  });

  it("solo con permiso se puede guardar; todo lo que no sea exactamente true cierra", () => {
    expect(armarElFormularioDeSeccion(null, true).puedeGuardar).toBe(true);
    expect(armarElFormularioDeSeccion(null, false).puedeGuardar).toBe(false);
    expect(armarElFormularioDeSeccion(null, undefined).puedeGuardar).toBe(false);
  });

  it("usa el diccionario si se lo dan", () => {
    const f = armarElFormularioDeSeccion(null, true, { "catalogo.accion.guardar": "Listo" });
    expect(f.guardar).toBe("Listo");
  });
});

describe("sePuedeGuardarElNombre", () => {
  it("un nombre vacío o de solo blancos no se puede guardar", () => {
    expect(sePuedeGuardarElNombre("")).toBe(false);
    expect(sePuedeGuardarElNombre("   ")).toBe(false);
    expect(sePuedeGuardarElNombre("\t")).toBe(false);
  });

  it("un nombre con algo escrito sí (si es válido lo decide el servidor)", () => {
    expect(sePuedeGuardarElNombre("Cafés")).toBe(true);
    expect(sePuedeGuardarElNombre(" a ")).toBe(true);
  });
});
