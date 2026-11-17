import { describe, expect, it } from "vitest";
import { motivoDeAnulacion } from "./motivo";

describe("motivo de una anulación (decisión 155)", () => {
  it("obligatorio: ausente, vacío o en blanco es MOTIVO_OBLIGATORIO", () => {
    for (const vacio of [undefined, null, "", "   "]) {
      expect(motivoDeAnulacion(vacio)).toEqual({ ok: false, error: "MOTIVO_OBLIGATORIO" });
    }
  });
  it("lo recorta y lo deja canónico", () => {
    expect(motivoDeAnulacion("  Se equivocó   el cajero ")).toEqual({
      ok: true,
      valor: "Se equivocó el cajero",
    });
  });
  it("hasta 500 caracteres; más, o fuera de la lista de permitidos, es MOTIVO_INVALIDO", () => {
    expect(motivoDeAnulacion("a".repeat(500)).ok).toBe(true);
    expect(motivoDeAnulacion("a".repeat(501))).toEqual({ ok: false, error: "MOTIVO_INVALIDO" });
    for (const malo of ["<b>x</b>", "uno\ndos", "con 😀", "a‮b"]) {
      expect(motivoDeAnulacion(malo)).toEqual({ ok: false, error: "MOTIVO_INVALIDO" });
    }
  });
});
