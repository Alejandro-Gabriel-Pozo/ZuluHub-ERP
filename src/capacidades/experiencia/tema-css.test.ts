import { describe, expect, it } from "vitest";
import { cssDeTema, esColorDeMarca, VARIABLES_DE_MARCA } from "./tema-css";

const COMPLETO = {
  primary: "#112233",
  "on-primary": "#ffffff",
  secondary: "#445566",
  accent: "#aabbcc",
};

describe("cssDeTema", () => {
  it("las cuatro variables, en el orden de la lista", () => {
    expect(VARIABLES_DE_MARCA).toEqual(["primary", "on-primary", "secondary", "accent"]);
    expect(cssDeTema(COMPLETO)).toBe(
      ":root{--brand-primary:#112233;--brand-on-primary:#ffffff;--brand-secondary:#445566;--brand-accent:#aabbcc}",
    );
  });

  it("el orden de las claves de entrada no cambia la salida", () => {
    expect(cssDeTema({ accent: "#aabbcc", primary: "#112233" })).toBe(
      ":root{--brand-primary:#112233;--brand-accent:#aabbcc}",
    );
  });

  it("solo los tokens presentes", () => {
    expect(cssDeTema({ secondary: "#445566" })).toBe(":root{--brand-secondary:#445566}");
  });

  it("sin tema, sin CSS", () => {
    expect(cssDeTema({})).toBe("");
  });

  it.each([
    "#fff",
    "#FFFFFF",
    "#12345g",
    "#1234567",
    "#12345",
    "112233",
    " #112233",
    "#112233 ",
    "#112233\n",
    "red",
    "rgb(0,0,0)",
    "url(//evil.test/x)",
    "#112233;}body{display:none",
    "#112233}",
    "",
  ])("el valor %j no se escribe", (valor) => {
    expect(cssDeTema({ primary: valor, accent: "#aabbcc" })).toBe(":root{--brand-accent:#aabbcc}");
    expect(cssDeTema({ primary: valor })).toBe("");
  });

  it("claves ajenas, con otro nombre o heredadas no se escriben", () => {
    expect(
      cssDeTema({
        background: "#112233",
        "--brand-primary": "#112233",
        Primary: "#112233",
        "primary ": "#112233",
        "x}body{display:none": "#112233",
      }),
    ).toBe("");
    expect(cssDeTema(Object.create({ primary: "#112233" }) as Record<string, string>)).toBe("");
    expect(cssDeTema({ constructor: "#112233", __proto__: "#112233" })).toBe("");
  });

  it("nunca escribe nada fuera de variables --brand-* con colores", () => {
    const css = cssDeTema(COMPLETO);
    expect(css).toMatch(/^:root\{(--brand-[a-z-]+:#[0-9a-f]{6};)*--brand-[a-z-]+:#[0-9a-f]{6}\}$/);
  });
});

describe("esColorDeMarca", () => {
  it.each(["#000000", "#ffffff", "#0a1b2c"])("%s es un color de marca", (c) => {
    expect(esColorDeMarca(c)).toBe(true);
  });
  it.each([
    "",
    "#fff",
    "#FFFFFF",
    "#12345g",
    "#1234567",
    "red",
    " #112233",
    "#112233 ",
    "#112233\n",
  ])("%j no lo es", (c) => {
    expect(esColorDeMarca(c)).toBe(false);
  });
});
