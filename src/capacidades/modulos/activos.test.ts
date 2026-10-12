import { describe, expect, it } from "vitest";
import { clavesDe, esClaveDe, estadoDeModulos } from "./activos";
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

/** Atajo: los dos conjuntos, ordenados, para comparar. */
const estado = (activados: readonly string[], habilitados: readonly string[]) => {
  const e = estadoDeModulos(CATALOGO, activados, habilitados);
  return { activos: ordenados(e.modulosActivos), soloLectura: ordenados(e.modulosEnSoloLectura) };
};

describe("estadoDeModulos: la matriz de §B.6", () => {
  it("sin activados, solo los obligatorios, sea cual sea el plan", () => {
    expect(estado([], [])).toEqual({ activos: ["base", "futuroObligatorio"], soloLectura: [] });
    expect(estado([], ["ventas", "stock"])).toEqual({
      activos: ["base", "futuroObligatorio"],
      soloLectura: [],
    });
  });

  it("activado y habilitado por el plan: activo", () => {
    expect(estado(["ventas", "stock"], ["ventas", "stock"])).toEqual({
      activos: ["base", "futuroObligatorio", "stock", "ventas"],
      soloLectura: [],
    });
  });

  it("activado pero fuera del techo del plan: solo lectura (una baja de plan no borra nada)", () => {
    expect(estado(["ventas", "stock"], ["stock"])).toEqual({
      activos: ["base", "futuroObligatorio", "stock"],
      soloLectura: ["ventas"],
    });
    expect(estado(["ventas"], [])).toEqual({
      activos: ["base", "futuroObligatorio"],
      soloLectura: ["ventas"],
    });
  });

  it("habilitado por el plan pero no activado por la empresa: ni activo ni solo lectura", () => {
    expect(estado(["ventas"], ["ventas", "stock"])).toEqual({
      activos: ["base", "futuroObligatorio", "ventas"],
      soloLectura: [],
    });
  });

  it("volver a subir de plan devuelve el módulo a activo (nada se perdió)", () => {
    expect(estado(["ventas"], []).soloLectura).toEqual(["ventas"]);
    expect(estado(["ventas"], ["ventas"])).toEqual({
      activos: ["base", "futuroObligatorio", "ventas"],
      soloLectura: [],
    });
  });

  it("un módulo en desarrollo activado no habilita nada, ni siquiera solo lectura", () => {
    expect(estado(["futuro"], ["futuro"])).toEqual({
      activos: ["base", "futuroObligatorio"],
      soloLectura: [],
    });
    expect(estado(["futuro"], [])).toEqual({
      activos: ["base", "futuroObligatorio"],
      soloLectura: [],
    });
  });

  it("los obligatorios están activos aunque el plan no los nombre, y nunca en solo lectura", () => {
    expect(estado(["base", "futuroObligatorio"], [])).toEqual({
      activos: ["base", "futuroObligatorio"],
      soloLectura: [],
    });
    expect(estado(["base"], ["ventas"])).toEqual({
      activos: ["base", "futuroObligatorio"],
      soloLectura: [],
    });
  });

  it("una clave desconocida (activada o del plan) no habilita nada y no bloquea las demás (falla cerrado)", () => {
    expect(estado(["ya_no_existe", "ventas"], ["ventas"])).toEqual({
      activos: ["base", "futuroObligatorio", "ventas"],
      soloLectura: [],
    });
    expect(estado(["ya_no_existe"], ["ya_no_existe"])).toEqual({
      activos: ["base", "futuroObligatorio"],
      soloLectura: [],
    });
    expect(estado(["ventas", "ya_no_existe"], [])).toEqual({
      activos: ["base", "futuroObligatorio"],
      soloLectura: ["ventas"],
    });
  });

  it("los nombres heredados de Object no son módulos, ni activados ni habilitados", () => {
    const heredados = ["constructor", "toString", "__proto__", "hasOwnProperty"];
    expect(estado(heredados, heredados)).toEqual({
      activos: ["base", "futuroObligatorio"],
      soloLectura: [],
    });
    expect(estado(heredados, [])).toEqual({
      activos: ["base", "futuroObligatorio"],
      soloLectura: [],
    });
  });

  it("repetir una clave activada o habilitada no cambia nada", () => {
    expect(estado(["ventas", "ventas"], ["ventas", "ventas"])).toEqual(
      estado(["ventas"], ["ventas"]),
    );
    expect(estado(["stock", "stock"], [])).toEqual(estado(["stock"], []));
  });

  it("el orden de las listas no importa", () => {
    expect(estado(["stock", "ventas"], ["ventas"])).toEqual(
      estado(["ventas", "stock"], ["ventas"]),
    );
  });

  it("no modifica sus entradas", () => {
    const activados = Object.freeze(["ventas"]);
    const habilitados = Object.freeze(["stock"]);
    expect(() =>
      estadoDeModulos(Object.freeze({ ...CATALOGO }), activados, habilitados),
    ).not.toThrow();
    expect(activados).toEqual(["ventas"]);
    expect(habilitados).toEqual(["stock"]);
  });

  it("devuelve conjuntos nuevos en cada llamada (no comparte estado entre transacciones)", () => {
    const a = estadoDeModulos(CATALOGO, ["ventas"], []);
    const b = estadoDeModulos(CATALOGO, ["ventas"], []);
    expect(a.modulosActivos).not.toBe(b.modulosActivos);
    expect(a.modulosEnSoloLectura).not.toBe(b.modulosEnSoloLectura);
    a.modulosEnSoloLectura.has("ventas");
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
