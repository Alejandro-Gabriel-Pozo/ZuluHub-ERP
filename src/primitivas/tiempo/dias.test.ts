import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { diaDeLaSemana, diasEntre, fechaDeNumeroDeDia, numeroDeDia, sumarDias } from "./dias";
import { fechaCivilDesdeTexto, type FechaCivil } from "./fecha-civil";

const f = (texto: string): FechaCivil => {
  const r = fechaCivilDesdeTexto(texto);
  if (!r.ok) throw new Error(texto);
  return r.valor;
};

describe("días entre fechas civiles", () => {
  it.each([
    ["2024-02-28", "2024-03-01", 2],
    ["2023-02-28", "2023-03-01", 1],
    ["2100-02-28", "2100-03-01", 1],
    ["2000-02-28", "2000-03-01", 2],
    ["2026-12-30", "2027-01-02", 3],
    ["2026-05-10", "2026-05-10", 0],
    ["2026-05-10", "2026-05-08", -2],
  ])("%s a %s = %i", (desde, hasta, esperado) => {
    expect(diasEntre(f(desde), f(hasta))).toBe(esperado);
  });

  it("suma y resta días, cruzando mes, año y bisiesto", () => {
    expect(sumarDias(f("2024-02-28"), 1)).toEqual({ ok: true, valor: "2024-02-29" });
    expect(sumarDias(f("2026-12-31"), 1)).toEqual({ ok: true, valor: "2027-01-01" });
    expect(sumarDias(f("2027-01-01"), -1)).toEqual({ ok: true, valor: "2026-12-31" });
    expect(sumarDias(f("2026-05-10"), 0)).toEqual({ ok: true, valor: "2026-05-10" });
  });

  it("llega a los extremos y no los pasa", () => {
    expect(sumarDias(f("9999-12-30"), 1)).toEqual({ ok: true, valor: "9999-12-31" });
    expect(sumarDias(f("9999-12-31"), 1)).toEqual({ ok: false, error: "FECHA_CIVIL_INVALIDA" });
    expect(sumarDias(f("0001-01-02"), -1)).toEqual({ ok: true, valor: "0001-01-01" });
    expect(sumarDias(f("0001-01-01"), -1)).toEqual({ ok: false, error: "FECHA_CIVIL_INVALIDA" });
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])("rechaza %s días", (dias) => {
    expect(sumarDias(f("2026-05-10"), dias)).toEqual({
      ok: false,
      error: "CANTIDAD_DE_DIAS_INVALIDA",
    });
  });

  it("día de la semana ISO (1 = lunes … 7 = domingo)", () => {
    expect(diaDeLaSemana(f("1970-01-01"))).toBe(4);
    expect(diaDeLaSemana(f("2026-11-16"))).toBe(1);
    expect(diaDeLaSemana(f("2026-11-22"))).toBe(7);
    expect(diaDeLaSemana(f("2024-02-29"))).toBe(4);
    expect(diaDeLaSemana(f("1969-12-31"))).toBe(3);
  });

  it("coincide con Date.UTC en todo el rango (oráculo independiente) y es de ida y vuelta", () => {
    const fechas = fc.date({
      min: new Date("0001-01-02T00:00:00Z"),
      max: new Date("9999-12-30T00:00:00Z"),
      noInvalidDate: true,
    });
    fc.assert(
      fc.property(fechas, (d) => {
        const texto = d.toISOString().slice(0, 10) as FechaCivil;
        expect(numeroDeDia(texto)).toBe(Math.floor(d.getTime() / 86_400_000));
        expect(fechaDeNumeroDeDia(numeroDeDia(texto))).toBe(texto);
        expect(diaDeLaSemana(texto)).toBe(d.getUTCDay() === 0 ? 7 : d.getUTCDay());
      }),
    );
  });

  it("ida y vuelta en el último día de la era (29 de febrero de los años múltiplos de 400)", () => {
    for (const texto of [
      "0400-02-29",
      "1600-02-29",
      "2000-02-29",
      "2400-02-29",
      "2000-03-01",
      "2000-02-28",
    ]) {
      expect(fechaDeNumeroDeDia(numeroDeDia(f(texto)))).toBe(texto);
    }
    expect(sumarDias(f("2000-02-28"), 1)).toEqual({ ok: true, valor: "2000-02-29" });
    expect(sumarDias(f("2400-02-29"), 1)).toEqual({ ok: true, valor: "2400-03-01" });
  });

  it("es pura: la misma entrada da la misma salida", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (n) => {
        expect(sumarDias(f("2026-05-10"), n)).toEqual(sumarDias(f("2026-05-10"), n));
      }),
    );
  });
});
