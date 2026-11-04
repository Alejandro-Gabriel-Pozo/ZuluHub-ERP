import { describe, expect, it } from "vitest";
import { LARGO_MAXIMO_DEL_TELEFONO, telefonoDesdeTexto } from "./telefono";

const MALO = { ok: false, error: "TELEFONO_INVALIDO" } as const;

describe("telefono", () => {
  it("texto libre de una línea: se limpian los extremos y se conserva lo de adentro", () => {
    expect(telefonoDesdeTexto(" +54 11 4321-0000 ")).toEqual({
      ok: true,
      valor: "+54 11 4321-0000",
    });
    expect(telefonoDesdeTexto("4321-0000 int. 2")).toEqual({ ok: true, valor: "4321-0000 int. 2" });
    expect(telefonoDesdeTexto("x")).toEqual({ ok: true, valor: "x" });
  });

  it("un texto vacío o en blanco no es un teléfono", () => {
    for (const vacio of ["", "   ", "\t\n"]) expect(telefonoDesdeTexto(vacio)).toEqual(MALO);
  });

  it("el borde: 40 caracteres entran y 41 no, contando caracteres y no unidades de UTF-16", () => {
    expect(telefonoDesdeTexto("x".repeat(LARGO_MAXIMO_DEL_TELEFONO)).ok).toBe(true);
    expect(telefonoDesdeTexto("x".repeat(LARGO_MAXIMO_DEL_TELEFONO + 1))).toEqual(MALO);
    expect(telefonoDesdeTexto("📞".repeat(LARGO_MAXIMO_DEL_TELEFONO)).ok).toBe(true);
    expect(telefonoDesdeTexto("📞".repeat(LARGO_MAXIMO_DEL_TELEFONO + 1))).toEqual(MALO);
  });

  it("una sola línea: sin saltos, tabuladores ni otros caracteres de control", () => {
    for (const malo of ["43\n21", "43\t21", "43\u0000", "43\u009f21", "43\u007f21", "43\u001f21"]) {
      expect(telefonoDesdeTexto(malo), JSON.stringify(malo)).toEqual(MALO);
    }
  });
});
