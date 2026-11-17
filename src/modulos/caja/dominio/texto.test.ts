import { describe, expect, it } from "vitest";
import { LARGO_MAXIMO_DE_LA_EXPLICACION } from "../../cierre/publico";
import { motivoObligatorio, observacionOpcional } from "./texto";

describe("motivo obligatorio (la lista de permitidos de la explicación del cierre)", () => {
  it("devuelve el motivo en su forma canónica", () => {
    expect(motivoObligatorio("  Se pagó   el flete ")).toEqual({
      ok: true,
      valor: "Se pagó el flete",
    });
  });
  it("sin motivo, en blanco o con algo fuera de la lista es MOTIVO_INVALIDO", () => {
    for (const malo of [
      null,
      undefined,
      "",
      "   ",
      "con <b>",
      "dos\nlíneas",
      "x".repeat(LARGO_MAXIMO_DE_LA_EXPLICACION + 1),
    ]) {
      expect(motivoObligatorio(malo)).toEqual({ ok: false, error: "MOTIVO_INVALIDO" });
    }
  });
  it("admite el largo máximo exacto", () => {
    const justo = "x".repeat(LARGO_MAXIMO_DE_LA_EXPLICACION);
    expect(motivoObligatorio(justo)).toEqual({ ok: true, valor: justo });
  });
});

describe("observación opcional del cierre", () => {
  it("vacía es válida y queda en null", () => {
    for (const vacia of [null, undefined, "", "  "]) {
      expect(observacionOpcional(vacia)).toEqual({ ok: true, valor: null });
    }
  });
  it("con texto válido lo devuelve; con algo fuera de la lista es OBSERVACION_INVALIDA", () => {
    expect(observacionOpcional(" Faltó un billete ")).toEqual({
      ok: true,
      valor: "Faltó un billete",
    });
    expect(observacionOpcional("<script>")).toEqual({ ok: false, error: "OBSERVACION_INVALIDA" });
  });
});
