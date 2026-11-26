import { describe, expect, it } from "vitest";
import { FORMA_DE_LA_CLAVE_DE_CUENTA_DE_IMAGEN, huellaDeCuentaDeImagen } from "./cuenta-de-imagen";

describe("huellaDeCuentaDeImagen", () => {
  it("es un sha256 en hexadecimal, determinista, y cambia con la cuenta o el proveedor", () => {
    const h = huellaDeCuentaDeImagen("CLOUDINARY", "mi-cuenta");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDeCuentaDeImagen("CLOUDINARY", "mi-cuenta")).toBe(h);
    expect(huellaDeCuentaDeImagen("CLOUDINARY", "otra")).not.toBe(h);
    expect(huellaDeCuentaDeImagen("IMAGEKIT", "mi-cuenta")).not.toBe(h);
  });

  it("no confunde dos pares que concatenados darían lo mismo", () => {
    expect(huellaDeCuentaDeImagen("A", "bc")).not.toBe(huellaDeCuentaDeImagen("Ab", "c"));
  });
});

describe("FORMA_DE_LA_CLAVE_DE_CUENTA_DE_IMAGEN (la copia de `cuenta_de_imagen_clave_ck`)", () => {
  it("de 16 a 128 caracteres de [A-Za-z0-9_-]", () => {
    expect(FORMA_DE_LA_CLAVE_DE_CUENTA_DE_IMAGEN.test("a".repeat(16))).toBe(true);
    expect(FORMA_DE_LA_CLAVE_DE_CUENTA_DE_IMAGEN.test("a".repeat(128))).toBe(true);
    expect(FORMA_DE_LA_CLAVE_DE_CUENTA_DE_IMAGEN.test("a".repeat(15))).toBe(false);
    expect(FORMA_DE_LA_CLAVE_DE_CUENTA_DE_IMAGEN.test("a".repeat(129))).toBe(false);
    expect(FORMA_DE_LA_CLAVE_DE_CUENTA_DE_IMAGEN.test(`${"a".repeat(16)} `)).toBe(false);
    expect(FORMA_DE_LA_CLAVE_DE_CUENTA_DE_IMAGEN.test(`${"a".repeat(15)}\n`)).toBe(false);
  });
});
