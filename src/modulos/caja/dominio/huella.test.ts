import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decidirPorHuella, huellaDeCampos } from "./huella";

describe("huella de una operación", () => {
  it("es el sha256 en hexadecimal del JSON de la lista de campos", () => {
    const campos = ["caja.cobro", 3, null, "12.50"];
    expect(huellaDeCampos(campos)).toBe(
      createHash("sha256").update('["caja.cobro",3,null,"12.50"]').digest("hex"),
    );
    expect(huellaDeCampos([])).toBe(
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    );
  });
  it("tiene la forma que la base exige (64 hexadecimales minúscula)", () => {
    expect(huellaDeCampos(["a"])).toMatch(/^[0-9a-f]{64}$/);
  });
  it("el orden, el tipo y el contenido de cada campo importan", () => {
    const base = huellaDeCampos(["a", "b"]);
    expect(huellaDeCampos(["b", "a"])).not.toBe(base);
    expect(huellaDeCampos(["a", "b", null])).not.toBe(base);
    expect(huellaDeCampos(["1"])).not.toBe(huellaDeCampos([1]));
    expect(huellaDeCampos(["a"])).toBe(huellaDeCampos(["a"]));
  });
});

describe("qué hacer con una clave de idempotencia", () => {
  it("nueva, repetida o reutilizada", () => {
    expect(decidirPorHuella(null, "h1")).toBe("NUEVA");
    expect(decidirPorHuella("h1", "h1")).toBe("REPETIDA");
    expect(decidirPorHuella("h1", "h2")).toBe("CLAVE_REUTILIZADA");
  });
});
