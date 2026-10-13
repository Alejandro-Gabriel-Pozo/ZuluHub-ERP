import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { unirConO } from "./unir-con-o";

describe("unirConO", () => {
  it.each([
    [[], ""],
    [["A"], "A"],
    [["A", "B"], "A o B"],
    [["A", "B", "C"], "A, B o C"],
    [["papas fritas", "puré", "ensalada", "arroz"], "papas fritas, puré, ensalada o arroz"],
    [["", "B"], " o B"],
  ])("%j → %j", (entrada, esperado) => {
    expect(unirConO(entrada)).toBe(esperado);
  });

  it("no modifica lo que recibe", () => {
    const entrada = ["A", "B", "C"];
    unirConO(entrada);
    expect(entrada).toEqual(["A", "B", "C"]);
  });

  const textos = fc.array(
    fc
      .string({ unit: "grapheme-ascii", minLength: 1, maxLength: 8 })
      .filter((t) => !/[, ]/.test(t)),
    { maxLength: 8 },
  );

  it("es determinista y conserva los mismos elementos en el mismo orden", () => {
    fc.assert(
      fc.property(textos, (xs) => {
        const r = unirConO(xs);
        expect(unirConO([...xs])).toBe(r);
        const partes = xs.length < 2 ? xs : [...r.split(" o ")[0]!.split(", "), r.split(" o ")[1]!];
        expect(partes.filter((p) => p !== "")).toEqual(xs);
      }),
    );
  });

  it("nunca pone coma antes del «o» y termina con el último elemento", () => {
    fc.assert(
      fc.property(
        textos.filter((xs) => xs.length >= 2),
        (xs) => {
          const r = unirConO(xs);
          expect(r).not.toContain(", o ");
          expect(r.endsWith(` o ${xs.at(-1)}`)).toBe(true);
        },
      ),
    );
  });
});
