import { describe, expect, it } from "vitest";
import { esUnaLineaSinControl, largoEnCaracteres } from "./una-linea";

describe("una línea sin control", () => {
  it("acepta texto común, con acentos, emojis y espacios", () => {
    for (const bueno of ["", "hola mundo", "áéíóú ñ", "📞 4321", "a b"]) {
      expect(esUnaLineaSinControl(bueno), JSON.stringify(bueno)).toBe(true);
    }
  });

  it("rechaza saltos de línea, tabuladores y los controles C0, DEL y C1", () => {
    for (const malo of [
      "a\nb",
      "a\rb",
      "a\tb",
      "a\u0000b",
      "a\u001fb",
      "a\u007fb",
      "a\u0085b",
      "a\u009fb",
    ]) {
      expect(esUnaLineaSinControl(malo), JSON.stringify(malo)).toBe(false);
    }
  });

  it("el largo cuenta caracteres, no unidades de UTF-16", () => {
    expect(largoEnCaracteres("abc")).toBe(3);
    expect(largoEnCaracteres("📞")).toBe(1);
    expect("📞".length).toBe(2);
  });
});
