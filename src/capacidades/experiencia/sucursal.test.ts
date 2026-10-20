import { describe, expect, it } from "vitest";
import { claveDeSucursalLocal, sucursalElegida } from "./sucursal";

const s = (id: string) => ({ id });

describe("sucursalElegida: la preferencia local solo vale si sigue disponible", () => {
  it("la guardada, si está entre las disponibles", () => {
    expect(sucursalElegida("b", [s("a"), s("b")])).toBe("b");
    expect(sucursalElegida("a", [s("a")])).toBe("a");
  });

  it("la guardada que ya no está: la única que quede, o ninguna si hay varias", () => {
    expect(sucursalElegida("vieja", [s("a")])).toBe("a");
    expect(sucursalElegida("vieja", [s("a"), s("b")])).toBeNull();
  });

  it("sin nada guardado: la única, o ninguna si hay varias", () => {
    expect(sucursalElegida(null, [s("a")])).toBe("a");
    expect(sucursalElegida(null, [s("a"), s("b")])).toBeNull();
  });

  it("sin sucursales no hay elegida, ni siquiera la guardada", () => {
    expect(sucursalElegida(null, [])).toBeNull();
    expect(sucursalElegida("a", [])).toBeNull();
  });
});

describe("claveDeSucursalLocal", () => {
  it("es una por empresa", () => {
    expect(claveDeSucursalLocal("e1")).toBe("pd:sucursal:e1");
    expect(claveDeSucursalLocal("e1")).not.toBe(claveDeSucursalLocal("e2"));
  });
});
