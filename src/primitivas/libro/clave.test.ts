import { describe, expect, it } from "vitest";
import { exigirClave, FORMA_DE_CLAVE } from "./clave";

describe("exigirClave", () => {
  it("acepta 16 y 128 caracteres del conjunto permitido", () => {
    for (const largo of [16, 128]) {
      const clave = "aZ0_-".repeat(30).slice(0, largo);
      expect(exigirClave(clave)).toEqual({ ok: true, valor: clave });
    }
  });

  it.each([
    ["15 caracteres", "a".repeat(15)],
    ["129 caracteres", "a".repeat(129)],
    ["vacía", ""],
    ["con espacio", `${"a".repeat(16)} `],
    ["con espacio en el medio", `${"a".repeat(8)} ${"a".repeat(8)}`],
    ["con acento", `${"a".repeat(15)}é`],
    ["con salto de línea al final", `${"a".repeat(16)}\n`],
    ["con punto", `${"a".repeat(15)}.`],
  ])("rechaza %s", (_nombre, texto) => {
    expect(exigirClave(texto)).toEqual({ ok: false, error: "CLAVE_INVALIDA" });
  });

  it("la forma es la de caja y compras (16 a 128, letras, dígitos, guion y guion bajo)", () => {
    expect(FORMA_DE_CLAVE.source).toBe("^[A-Za-z0-9_-]{16,128}$");
  });
});
