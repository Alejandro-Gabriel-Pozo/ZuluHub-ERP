import { describe, expect, it } from "vitest";
import { clavesDe, esClaveDe, modulosActivosDe } from "./activos";
import type { CatalogoComercial } from "./catalogo";

const modulo = (
  estado: "disponible" | "en_desarrollo",
  obligatorio: boolean,
): CatalogoComercial[string] => ({
  estado,
  obligatorio,
  requiere: [],
  usaSiExiste: [],
  datosRequeridos: [],
  implementadoPor: [],
  acciones: {},
});

const CATALOGO = {
  base: modulo("disponible", true),
  ventas: modulo("disponible", false),
  stock: modulo("disponible", false),
  futuro: modulo("en_desarrollo", false),
  futuroObligatorio: modulo("en_desarrollo", true),
} as const;

const ordenados = (s: ReadonlySet<string>) => [...s].sort();

describe("modulosActivosDe", () => {
  it("sin activados, solo los obligatorios", () => {
    expect(ordenados(modulosActivosDe(CATALOGO, []))).toEqual(["base", "futuroObligatorio"]);
  });

  it("suma los activados que existen y están disponibles", () => {
    expect(ordenados(modulosActivosDe(CATALOGO, ["ventas", "stock"]))).toEqual([
      "base",
      "futuroObligatorio",
      "stock",
      "ventas",
    ]);
  });

  it("un módulo en desarrollo activado no habilita nada", () => {
    expect(ordenados(modulosActivosDe(CATALOGO, ["futuro"]))).toEqual([
      "base",
      "futuroObligatorio",
    ]);
  });

  it("una clave desconocida no habilita nada y no bloquea las demás (falla cerrado)", () => {
    expect(ordenados(modulosActivosDe(CATALOGO, ["ya_no_existe", "ventas"]))).toEqual([
      "base",
      "futuroObligatorio",
      "ventas",
    ]);
  });

  it("los nombres heredados de Object no son módulos", () => {
    const activos = modulosActivosDe(CATALOGO, [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
    ]);
    expect(ordenados(activos)).toEqual(["base", "futuroObligatorio"]);
  });

  it("repetir una clave activada no cambia nada", () => {
    expect(ordenados(modulosActivosDe(CATALOGO, ["ventas", "ventas"]))).toEqual([
      "base",
      "futuroObligatorio",
      "ventas",
    ]);
  });

  it("no modifica sus entradas", () => {
    const activados = Object.freeze(["ventas"]);
    expect(() => modulosActivosDe(Object.freeze({ ...CATALOGO }), activados)).not.toThrow();
  });
});

describe("esClaveDe y clavesDe", () => {
  it("esClaveDe: solo las claves propias", () => {
    expect(esClaveDe({ a: 1 }, "a")).toBe(true);
    expect(esClaveDe({ a: 1 }, "b")).toBe(false);
    expect(esClaveDe({ a: 1 }, "toString")).toBe(false);
    expect(esClaveDe({ a: 1 }, "__proto__")).toBe(false);
  });

  it("clavesDe: las claves propias, en orden de declaración", () => {
    expect(clavesDe({ b: 1, a: 2 })).toEqual(["b", "a"]);
    expect(clavesDe({})).toEqual([]);
  });
});
