import { afterEach, describe, expect, it, vi } from "vitest";
import { camposGuardables, descartarBorrador, guardarBorrador, leerBorrador } from "./borrador";

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("borrador de la sesión (sessionStorage de la pestaña)", () => {
  it("guarda y lee lo tipeado, y se descarta", () => {
    guardarBorrador("venta", { busqueda: "café", importe: "1234.50" });
    expect(leerBorrador("venta")).toEqual({ busqueda: "café", importe: "1234.50" });
    descartarBorrador("venta");
    expect(leerBorrador("venta")).toBeNull();
  });

  it("nunca guarda claves ni tokens: los campos que parecen secretos se descartan", () => {
    guardarBorrador("ingreso", {
      email: "ana@ejemplo.com",
      clave: "secreta",
      password: "x",
      contrasena: "y",
      token: "t",
      codigoSecreto: "z",
      importe: "10.00",
    });
    expect(leerBorrador("ingreso")).toEqual({ email: "ana@ejemplo.com", importe: "10.00" });
    const crudo = sessionStorage.getItem("zh:borrador:ingreso") ?? "";
    for (const secreto of ["secreta", "password", "contrasena", "token", "codigoSecreto"]) {
      expect(crudo).not.toContain(secreto);
    }
  });

  it("camposGuardables filtra por nombre, sin importar mayúsculas", () => {
    expect(camposGuardables({ Clave: "1", TOKEN: "2", Passw: "3", nombre: "ok" })).toEqual({
      nombre: "ok",
    });
  });

  it("es de la pestaña: usa sessionStorage y no localStorage", () => {
    guardarBorrador("venta", { a: "1" });
    expect(sessionStorage.getItem("zh:borrador:venta")).not.toBeNull();
    expect(localStorage.getItem("zh:borrador:venta")).toBeNull();
  });

  it.each([
    ["no es JSON", "{no"],
    ["es una lista", "[1,2]"],
    ["es un texto", '"x"'],
    ["no es un objeto de textos", '{"a":1}'],
    ["es null", "null"],
  ])("un contenido que %s se ignora", (_caso, crudo) => {
    sessionStorage.setItem("zh:borrador:venta", crudo);
    expect(leerBorrador("venta")).toBeNull();
  });

  it("si el almacenamiento falla (ventana privada, sitio bloqueado), no rompe", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("lleno", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    expect(() => guardarBorrador("venta", { a: "1" })).not.toThrow();
    expect(leerBorrador("venta")).toBeNull();
    expect(() => descartarBorrador("venta")).not.toThrow();
  });
});
