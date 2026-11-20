import { describe, expect, it } from "vitest";
import type { FechaCivil } from "./fecha-civil";
import { nochesDe, nochesEntre } from "./noches";

const f = (t: string) => t as FechaCivil;

describe("noches [entrada, salida)", () => {
  it("cuenta las noches y no el día de salida", () => {
    expect(nochesEntre(f("2026-05-10"), f("2026-05-11"))).toEqual({ ok: true, valor: 1 });
    expect(nochesEntre(f("2026-05-10"), f("2026-05-15"))).toEqual({ ok: true, valor: 5 });
  });

  it("cruza fin de año y febrero bisiesto", () => {
    expect(nochesEntre(f("2026-12-30"), f("2027-01-02"))).toEqual({ ok: true, valor: 3 });
    expect(nochesEntre(f("2024-02-28"), f("2024-03-01"))).toEqual({ ok: true, valor: 2 });
    expect(nochesDe({ entrada: f("2026-12-30"), salida: f("2027-01-02") })).toEqual({
      ok: true,
      valor: ["2026-12-30", "2026-12-31", "2027-01-01"],
    });
  });

  it("lista cada noche, de la entrada al día anterior a la salida", () => {
    expect(nochesDe({ entrada: f("2024-02-28"), salida: f("2024-03-01") })).toEqual({
      ok: true,
      valor: ["2024-02-28", "2024-02-29"],
    });
    expect(nochesDe({ entrada: f("2026-05-10"), salida: f("2026-05-11") })).toEqual({
      ok: true,
      valor: ["2026-05-10"],
    });
  });

  it("salida igual o anterior a la entrada es error explícito", () => {
    const error = { ok: false, error: "RANGO_DE_NOCHES_INVALIDO" };
    expect(nochesEntre(f("2026-05-10"), f("2026-05-10"))).toEqual(error);
    expect(nochesEntre(f("2026-05-10"), f("2026-05-09"))).toEqual(error);
    expect(nochesDe({ entrada: f("2026-05-10"), salida: f("2026-05-10") })).toEqual(error);
    expect(nochesDe({ entrada: f("2026-05-10"), salida: f("2026-05-01") })).toEqual(error);
  });

  it("la lista tiene tantas fechas como noches", () => {
    const rango = { entrada: f("2026-01-01"), salida: f("2027-01-01") };
    const lista = nochesDe(rango);
    expect(lista.ok && lista.valor.length).toBe(365);
  });
});
