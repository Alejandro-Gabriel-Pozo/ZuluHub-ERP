import { describe, expect, it } from "vitest";
import { codigoDeLoteDesdeTexto, LARGO_MAXIMO_DEL_CODIGO_DE_LOTE } from "./codigo-de-lote";

describe("codigoDeLoteDesdeTexto", () => {
  it("admite letras, dígitos, punto y guion, de 1 a 40 caracteres; distingue mayúsculas (son lotes distintos)", () => {
    for (const bueno of [
      "A",
      "L-1104",
      "q.7",
      "2026-11-26.B",
      "a".repeat(LARGO_MAXIMO_DEL_CODIGO_DE_LOTE),
    ]) {
      expect(codigoDeLoteDesdeTexto(bueno), bueno).toEqual({ ok: true, valor: bueno });
    }
    expect(codigoDeLoteDesdeTexto("a-1")).toMatchObject({ ok: true, valor: "a-1" });
    expect(codigoDeLoteDesdeTexto("A-1")).toMatchObject({ ok: true, valor: "A-1" });
  });

  it("rechaza lo vacío, lo largo, el guion bajo (SIN_ASIGNAR es el reservado), los espacios, los acentos y todo lo que no está en la lista", () => {
    for (const malo of [
      "",
      "a".repeat(LARGO_MAXIMO_DEL_CODIGO_DE_LOTE + 1),
      "SIN_ASIGNAR",
      "L 1",
      "L\n1",
      "Lóte",
      "L/1",
      "<L1>",
      " L1",
      "L1 ",
      "😀",
    ]) {
      expect(codigoDeLoteDesdeTexto(malo), JSON.stringify(malo)).toEqual({
        ok: false,
        error: "CODIGO_INVALIDO",
      });
    }
  });
});
