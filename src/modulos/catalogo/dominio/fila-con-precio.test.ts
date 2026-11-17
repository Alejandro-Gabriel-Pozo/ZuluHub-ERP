import { describe, expect, it } from "vitest";
import { filaConPrecio } from "./fila-con-precio";

describe("filaConPrecio", () => {
  it("una fila con precio es un precio; con precio nulo (abierto o «vuelve a la empresa») o sin fila, no", () => {
    expect(filaConPrecio({ precio: "1500" })).toBe(true);
    expect(filaConPrecio({ precio: "0" })).toBe(true);
    expect(filaConPrecio({ precio: "" })).toBe(true);
    expect(filaConPrecio({ precio: null })).toBe(false);
    expect(filaConPrecio(null)).toBe(false);
  });
});
