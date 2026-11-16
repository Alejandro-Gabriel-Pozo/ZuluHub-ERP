import { describe, expect, it } from "vitest";
import { CONTRASTE_MINIMO_DE_LA_CARTA, colorDeLaCarta } from "./color-de-la-carta";

const dar = (c: unknown) => {
  const r = colorDeLaCarta(c);
  if (!r.ok) throw new Error("se esperaba un color válido");
  return r.valor;
};

describe("colorDeLaCarta: valores exactos", () => {
  it("el mínimo de la carta es 7 a 1 (CYN 101 y 107)", () => {
    expect(CONTRASTE_MINIMO_DE_LA_CARTA).toBe(7);
  });

  it("negro y blanco: contraste máximo y texto opuesto, sin ajustar", () => {
    expect(dar("#000000")).toEqual({
      hex: "#000000",
      textoSobreColor: "BLANCO",
      ajustado: false,
      contraste: 21,
    });
    expect(dar("#ffffff")).toEqual({
      hex: "#ffffff",
      textoSobreColor: "NEGRO",
      ajustado: false,
      contraste: 21,
    });
  });

  it("un color oscuro que ya llega no cambia (Azul de la paleta)", () => {
    const r = dar("#1f4e79");
    expect(r.hex).toBe("#1f4e79");
    expect(r.ajustado).toBe(false);
    expect(r.textoSobreColor).toBe("BLANCO");
    expect(r.contraste).toBeGreaterThanOrEqual(7);
  });

  it("normaliza mayúsculas a minúsculas sin marcarlo como ajuste", () => {
    expect(dar("#1F4E79")).toEqual(dar("#1f4e79"));
  });

  it("el ejemplo del aviso (#0e7490) no llega a 7:1: se oscurece, conserva el tono y queda en 7 o más", () => {
    const r = dar("#0e7490");
    expect(r.ajustado).toBe(true);
    expect(r.hex).not.toBe("#0e7490");
    expect(r.textoSobreColor).toBe("BLANCO");
    expect(r.contraste).toBeGreaterThanOrEqual(7);
  });

  it("amarillo puro ya se lee con texto negro (19 a 1): no se toca", () => {
    const r = dar("#ffff00");
    expect(r.ajustado).toBe(false);
    expect(r.textoSobreColor).toBe("NEGRO");
    expect(r.contraste).toBeGreaterThanOrEqual(7);
  });

  it("un gris medio (#808080) no llega con ninguno de los dos textos: se oscurece y pasa a texto blanco", () => {
    const r = dar("#808080");
    expect(r.ajustado).toBe(true);
    expect(r.textoSobreColor).toBe("BLANCO");
    expect(r.contraste).toBeGreaterThanOrEqual(7);
  });

  it("el contraste informado se trunca, no se redondea hacia arriba", () => {
    // gris medio: 7,00 exacto no existe; el informado nunca supera al real.
    const r = dar("#595959");
    expect(r.contraste).toBeLessThanOrEqual(7.0 + 0.5);
    expect(Number.isFinite(r.contraste)).toBe(true);
  });
});

describe("colorDeLaCarta: lo que no es `#` + 6 hexadecimales se rechaza (lista de permitidos)", () => {
  const invalidos: unknown[] = [
    "",
    "#fff",
    "fff",
    "1f4e79",
    "#1f4e7",
    "#1f4e790",
    "#1f4e7g",
    " #1f4e79",
    "#1f4e79 ",
    "#1f4e79\n",
    "rgb(1,2,3)",
    "url(x)",
    "red",
    "#ÀÀÀÀÀÀ",
    "＃1f4e79",
    "#1f4e79\u0000",
    null,
    undefined,
    123,
    {},
    [],
    true,
  ];
  it.each(invalidos.map((v) => [JSON.stringify(v) ?? String(v), v] as const))(
    "rechaza %s",
    (_n, v) => {
      expect(colorDeLaCarta(v)).toEqual({
        ok: false,
        error: { codigo: "COLOR_DE_CARTA_INVALIDO" },
      });
    },
  );

  it("no lanza con entradas hostiles", () => {
    expect(() => colorDeLaCarta(Symbol("x"))).not.toThrow();
    expect(() => colorDeLaCarta("İİİİİİİ")).not.toThrow();
    expect(() => colorDeLaCarta("K".repeat(7))).not.toThrow();
  });
});
