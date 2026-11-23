import { describe, expect, it } from "vitest";
import { entradaDeProductosParaComprar } from "./entradas-de-comprar";

describe("entradaDeProductosParaComprar", () => {
  it.each([undefined, {}, { texto: "" }, { texto: "   " }])(
    "sin texto (%j) es «sin filtro»",
    (crudo) => {
      expect(entradaDeProductosParaComprar(crudo)).toEqual({
        ok: true,
        valor: { ninguno: false, texto: undefined },
      });
    },
  );

  it("un texto válido pasa tal cual", () => {
    expect(entradaDeProductosParaComprar({ texto: "Harina 000" })).toEqual({
      ok: true,
      valor: { ninguno: false, texto: "Harina 000" },
    });
  });

  it.each(["a\u0000b", "<b>", "a​b", "x".repeat(121), "+uno"])(
    "un texto que la búsqueda no permite (%j) es «nada puede coincidir», no una búsqueda ancha",
    (texto) => {
      expect(entradaDeProductosParaComprar({ texto })).toEqual({
        ok: true,
        valor: { ninguno: true },
      });
    },
  );

  it.each([{ texto: 5 }, { texto: "x".repeat(1001) }, "texto"])(
    "un pedido sin la forma pedida (%j) es un dato inválido",
    (crudo) => {
      expect(entradaDeProductosParaComprar(crudo)).toMatchObject({ ok: false });
    },
  );

  it("ignora lo que el navegador mande de más (empresa, tope, clase)", () => {
    expect(
      entradaDeProductosParaComprar({
        texto: "sal",
        empresaId: "otra",
        limite: 9999,
        clase: "VENDIBLE",
      }),
    ).toEqual({ ok: true, valor: { ninguno: false, texto: "sal" } });
  });
});
