import { describe, expect, it } from "vitest";
import {
  PRODUCTOS_PARA_BUSCAR,
  coincideConLaBusqueda,
  filtrarSecciones,
  normalizarParaBuscar,
} from "./busqueda";

const p = (nombre: string, descripcion: string | null = null) => ({ nombre, descripcion });

describe("normalizarParaBuscar", () => {
  it.each([
    ["Ñoquis  de CALABAZA", "noquis de calabaza"],
    ["  Café   con leche ", "cafe con leche"],
    ["Pingüino", "pinguino"],
    ["ÁÉÍÓÚ", "aeiou"],
    ["İstanbul", "istanbul"],
    ["tab\tsalto\nlinea", "tab salto linea"],
    ["", ""],
    ["   ", ""],
  ])("%j → %j", (entrada, esperado) => {
    expect(normalizarParaBuscar(entrada)).toBe(esperado);
  });

  it("es idempotente sobre un caso con todo junto", () => {
    const una = normalizarParaBuscar("  CRÈME   Brûlée ");
    expect(normalizarParaBuscar(una)).toBe(una);
  });
});

describe("coincideConLaBusqueda", () => {
  it("una búsqueda vacía o en blanco responde todo", () => {
    expect(coincideConLaBusqueda(p("Medialuna"), "")).toBe(true);
    expect(coincideConLaBusqueda(p("Medialuna"), "   ")).toBe(true);
  });

  it("sin importar tildes ni mayúsculas, en el nombre", () => {
    expect(coincideConLaBusqueda(p("Café con leche"), "CAFE")).toBe(true);
    expect(coincideConLaBusqueda(p("Cafe con leche"), "café")).toBe(true);
    expect(coincideConLaBusqueda(p("Ñoquis"), "noqui")).toBe(true);
  });

  it("también en la descripción", () => {
    expect(coincideConLaBusqueda(p("Capuchino", "Espresso con leche espumada"), "espumada")).toBe(
      true,
    );
  });

  it("cada palabra tiene que estar, en cualquier orden y repartidas entre nombre y descripción", () => {
    const capuchino = p("Capuchino", "Espresso y leche espumada");
    expect(coincideConLaBusqueda(capuchino, "leche capuchino")).toBe(true);
    expect(coincideConLaBusqueda(capuchino, "capuchino cacao")).toBe(false);
  });

  it("una descripción ausente no rompe ni suma texto", () => {
    expect(coincideConLaBusqueda(p("Medialuna"), "null")).toBe(false);
    expect(coincideConLaBusqueda(p("Medialuna"), "undefined")).toBe(false);
  });

  it("no encuentra lo que no está", () => {
    expect(coincideConLaBusqueda(p("Medialuna", "De manteca"), "pizza")).toBe(false);
  });

  it("el nombre exacto siempre lo encuentra", () => {
    for (const nombre of ["Café con leche", "Ñoquis de papa", "  Té   verde ", "İstanbul"]) {
      expect(coincideConLaBusqueda(p(nombre), nombre)).toBe(true);
    }
  });
});

describe("filtrarSecciones", () => {
  const secciones = [
    { id: "cafes", nombre: "Cafés", productos: [p("Espresso"), p("Capuchino", "Con leche")] },
    { id: "salados", nombre: "Salados", productos: [p("Tostado"), p("Ensalada")] },
    { id: "dulces", nombre: "Dulces", productos: [p("Brownie")] },
  ];

  it("sin búsqueda deja todo, en el mismo orden", () => {
    const r = filtrarSecciones(secciones, "");
    expect(r.secciones).toEqual(secciones);
    expect(r.total).toBe(5);
  });

  it("deja cada sección con SOLO sus productos que responden y conserva el orden y el resto de sus datos", () => {
    const r = filtrarSecciones(secciones, "LECHE");
    expect(r.secciones).toEqual([
      { id: "cafes", nombre: "Cafés", productos: [p("Capuchino", "Con leche")] },
    ]);
    expect(r.total).toBe(1);
  });

  it("las secciones sin resultados desaparecen y las que quedan siguen en su orden", () => {
    const r = filtrarSecciones(secciones, "e");
    expect(r.secciones.map((s) => s.id)).toEqual(["cafes", "salados", "dulces"]);
    expect(r.total).toBe(4);
    const solo = filtrarSecciones(secciones, "brow");
    expect(solo.secciones.map((s) => s.id)).toEqual(["dulces"]);
  });

  it("cuenta los productos de todas las secciones, no las secciones", () => {
    // «o»: Espresso, Capuchino («Con leche»), Tostado, Brownie.
    expect(filtrarSecciones(secciones, "o").total).toBe(4);
  });

  it("sin coincidencias: ninguna sección y total cero", () => {
    expect(filtrarSecciones(secciones, "zzz")).toEqual({ secciones: [], total: 0 });
  });

  it("no modifica lo que recibe", () => {
    const copia = structuredClone(secciones);
    filtrarSecciones(secciones, "e");
    expect(secciones).toEqual(copia);
  });

  it("el campo aparece con más de 40 productos", () => {
    expect(PRODUCTOS_PARA_BUSCAR).toBe(40);
  });
});
