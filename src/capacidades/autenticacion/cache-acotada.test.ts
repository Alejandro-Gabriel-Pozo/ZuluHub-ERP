import { describe, expect, it } from "vitest";
import { crearCacheAcotada } from "./cache-acotada";

describe("crearCacheAcotada", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "una capacidad que no es un entero de 1 o más (%s) es un error de programación",
    (capacidad) => {
      expect(() => crearCacheAcotada<string>(capacidad)).toThrow(
        new RangeError("la capacidad de la caché es un entero de 1 o más"),
      );
    },
  );

  it("una capacidad de 1 sirve", () => {
    expect(() => crearCacheAcotada<string>(1)).not.toThrow();
  });

  it("crea lo que falta una sola vez y devuelve lo mismo después, sin volver a crear", () => {
    const cache = crearCacheAcotada<{ n: number }>(3);
    let creados = 0;
    const crear = () => ({ n: ++creados });
    const primero = cache.obtenerOCrear("a", crear);
    expect(cache.obtenerOCrear("a", crear)).toBe(primero);
    expect(cache.obtenerOCrear("a", crear)).toBe(primero);
    expect(creados).toBe(1);
    expect(cache.obtenerOCrear("b", crear)).not.toBe(primero);
    expect(creados).toBe(2);
  });

  it("guarda un valor aunque sea falso (cero, vacío): lo que importa es que exista", () => {
    const cache = crearCacheAcotada<number>(2);
    let creados = 0;
    expect(cache.obtenerOCrear("cero", () => (creados++, 0))).toBe(0);
    expect(cache.obtenerOCrear("cero", () => (creados++, 1))).toBe(0);
    expect(creados).toBe(1);
  });

  it("nunca guarda más que su capacidad y saca primero el menos usado", () => {
    const cache = crearCacheAcotada<string>(2);
    const crear = (valor: string) => () => valor;
    cache.obtenerOCrear("a", crear("A"));
    cache.obtenerOCrear("b", crear("B"));
    expect(cache.tamano()).toBe(2);
    cache.obtenerOCrear("c", crear("C"));
    expect(cache.tamano()).toBe(2);
    // «a» era el más antiguo: salió. «b» y «c» siguen.
    let creadosDeNuevo = 0;
    cache.obtenerOCrear("b", () => (creadosDeNuevo++, "otro"));
    cache.obtenerOCrear("c", () => (creadosDeNuevo++, "otro"));
    expect(creadosDeNuevo).toBe(0);
    expect(cache.obtenerOCrear("a", crear("A2"))).toBe("A2");
  });

  it("usar una entrada la vuelve la más reciente: la que sale es otra", () => {
    const cache = crearCacheAcotada<string>(2);
    cache.obtenerOCrear("a", () => "A");
    cache.obtenerOCrear("b", () => "B");
    cache.obtenerOCrear("a", () => "no se crea"); // «a» pasa a ser la más reciente
    cache.obtenerOCrear("c", () => "C"); // sale «b»
    expect(cache.obtenerOCrear("a", () => "A-nueva")).toBe("A");
    expect(cache.obtenerOCrear("c", () => "C-nueva")).toBe("C");
    expect(cache.obtenerOCrear("b", () => "B-nueva")).toBe("B-nueva");
  });

  it("con capacidad 1 cada entrada nueva saca a la anterior", () => {
    const cache = crearCacheAcotada<string>(1);
    cache.obtenerOCrear("a", () => "A");
    cache.obtenerOCrear("b", () => "B");
    expect(cache.tamano()).toBe(1);
    expect(cache.obtenerOCrear("a", () => "A2")).toBe("A2");
  });

  it("si crear lanza, no queda nada guardado y el próximo intento vuelve a crear", () => {
    const cache = crearCacheAcotada<string>(2);
    expect(() =>
      cache.obtenerOCrear("a", () => {
        throw new Error("no se pudo");
      }),
    ).toThrow("no se pudo");
    expect(cache.tamano()).toBe(0);
    expect(cache.obtenerOCrear("a", () => "A")).toBe("A");
    expect(cache.tamano()).toBe(1);
  });

  it("empieza vacía", () => {
    expect(crearCacheAcotada<string>(5).tamano()).toBe(0);
  });
});
