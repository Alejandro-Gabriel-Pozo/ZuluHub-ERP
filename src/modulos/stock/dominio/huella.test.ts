import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { decidirPorHuella, huellaDeComando } from "./huella";

describe("huellaDeComando", () => {
  it("es el sha256 en hexadecimal del contenido canónico, escrito aparte", () => {
    const texto =
      '["entrada",["d1","COMPRA",null],[["a","1.5000","KILOGRAMO",null],["b","2.0000","UNIDAD","3.250000"]]]';
    const esperada = createHash("sha256").update(texto).digest("hex");
    expect(
      huellaDeComando(
        "entrada",
        ["d1", "COMPRA", null],
        [
          ["b", "2.0000", "UNIDAD", "3.250000"],
          ["a", "1.5000", "KILOGRAMO", null],
        ],
      ),
    ).toBe(esperada);
    expect(esperada).toMatch(/^[0-9a-f]{64}$/);
  });

  it("no depende del orden de los renglones", () => {
    const a = ["a", "1.0000"];
    const b = ["b", "2.0000"];
    const c = ["a", "2.0000"];
    expect(huellaDeComando("x", [], [a, b, c])).toBe(huellaDeComando("x", [], [c, a, b]));
  });

  it("cualquier campo distinto da otra huella", () => {
    const base = huellaDeComando("entrada", ["d1", "COMPRA"], [["a", "1.0000"]]);
    expect(huellaDeComando("salida", ["d1", "COMPRA"], [["a", "1.0000"]])).not.toBe(base);
    expect(huellaDeComando("entrada", ["d2", "COMPRA"], [["a", "1.0000"]])).not.toBe(base);
    expect(huellaDeComando("entrada", ["d1", "COMPRA", null], [["a", "1.0000"]])).not.toBe(base);
    expect(huellaDeComando("entrada", ["d1", "COMPRA"], [["a", "1.0001"]])).not.toBe(base);
    expect(
      huellaDeComando(
        "entrada",
        ["d1", "COMPRA"],
        [
          ["a", "1.0000"],
          ["a", "1.0000"],
        ],
      ),
    ).not.toBe(base);
    expect(huellaDeComando("entrada", ["d1", "COMPRA"], [])).not.toBe(base);
  });

  it("la operación, la cabecera y los renglones no se confunden entre sí", () => {
    expect(huellaDeComando("a", ["b"], [])).not.toBe(huellaDeComando("a", [], [["b"]]));
    expect(huellaDeComando("a", ["b", "c"], [])).not.toBe(huellaDeComando("a", ["b"], [["c"]]));
    expect(huellaDeComando("a,b", [], [])).not.toBe(huellaDeComando("a", ["b"], []));
  });

  it("un número y su texto son campos distintos (el contenido es JSON)", () => {
    expect(huellaDeComando("x", [1], [])).not.toBe(huellaDeComando("x", ["1"], []));
  });

  it("propiedad: es determinista, de 64 hexadecimales, y reordenar renglones no la cambia", () => {
    const campo = fc.oneof(fc.string(), fc.integer(), fc.constant(null));
    const renglon = fc.array(campo, { maxLength: 4 });
    fc.assert(
      fc.property(
        fc.string(),
        fc.array(campo, { maxLength: 4 }),
        fc.array(renglon, { maxLength: 5 }),
        (operacion, cabecera, renglones) => {
          const h = huellaDeComando(operacion, cabecera, renglones);
          expect(h).toMatch(/^[0-9a-f]{64}$/);
          expect(huellaDeComando(operacion, cabecera, renglones)).toBe(h);
          expect(huellaDeComando(operacion, cabecera, [...renglones].reverse())).toBe(h);
        },
      ),
    );
  });
});

describe("decidirPorHuella", () => {
  it("sin huella guardada la clave es nueva; con la misma es una repetición; con otra, reutilizada", () => {
    expect(decidirPorHuella(null, "abc")).toBe("NUEVA");
    expect(decidirPorHuella("abc", "abc")).toBe("REPETIDA");
    expect(decidirPorHuella("abc", "abd")).toBe("CLAVE_REUTILIZADA");
    expect(decidirPorHuella("", "")).toBe("REPETIDA");
  });
});
