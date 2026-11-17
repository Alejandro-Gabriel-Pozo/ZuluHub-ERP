import { describe, expect, it } from "vitest";
import { decidirPorHuella, huellaDeComando } from "./huella";

describe("huellaDeComando", () => {
  it("es un sha256 en hex y es estable", () => {
    const h = huellaDeComando("registrarCompra", ["s", null], [["a", "1.0000"]]);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDeComando("registrarCompra", ["s", null], [["a", "1.0000"]])).toBe(h);
  });
  it("el valor exacto para un contenido conocido (fija el formato canónico: JSON, renglones ordenados y separados por coma)", () => {
    expect(
      huellaDeComando(
        "op",
        ["x", 1, null, true],
        [
          ["b", 2],
          ["a", 1],
        ],
      ),
    ).toBe("9aaa80d9eadd933629b845b0f325bd897222b1cb86a7d3c726fe4040899dfae9");
  });
  it("el orden de los renglones no cambia la huella; cualquier otro campo, sí", () => {
    const a = huellaDeComando(
      "op",
      ["x"],
      [
        ["a", 1],
        ["b", 2],
      ],
    );
    expect(
      huellaDeComando(
        "op",
        ["x"],
        [
          ["b", 2],
          ["a", 1],
        ],
      ),
    ).toBe(a);
    expect(
      huellaDeComando(
        "otra",
        ["x"],
        [
          ["a", 1],
          ["b", 2],
        ],
      ),
    ).not.toBe(a);
    expect(
      huellaDeComando(
        "op",
        ["y"],
        [
          ["a", 1],
          ["b", 2],
        ],
      ),
    ).not.toBe(a);
    expect(
      huellaDeComando(
        "op",
        ["x"],
        [
          ["a", 1],
          ["b", 3],
        ],
      ),
    ).not.toBe(a);
    expect(huellaDeComando("op", ["x"], [["a", 1]])).not.toBe(a);
  });
  it("no confunde un campo con otro (null, texto, número y booleano)", () => {
    const hs = [null, "null", 0, "0", false, ""].map((c) => huellaDeComando("op", [c], []));
    expect(new Set(hs).size).toBe(hs.length);
    expect(huellaDeComando("op", ["a", "b"], [])).not.toBe(huellaDeComando("op", ["a,b"], []));
    expect(huellaDeComando("op", [], [["a"]])).not.toBe(huellaDeComando("op", ["a"], []));
  });
});

describe("decidirPorHuella", () => {
  it("nueva, repetida o clave reutilizada", () => {
    expect(decidirPorHuella(null, "h")).toBe("NUEVA");
    expect(decidirPorHuella("h", "h")).toBe("REPETIDA");
    expect(decidirPorHuella("h", "g")).toBe("CLAVE_REUTILIZADA");
  });
});
