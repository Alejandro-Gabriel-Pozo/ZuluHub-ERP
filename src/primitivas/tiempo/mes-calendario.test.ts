import { describe, expect, it } from "vitest";
import { fechaCivilDesdeTexto, type FechaCivil } from "./fecha-civil";
import {
  contiene,
  diasDelMes,
  mesAnterior,
  mesCalendarioDesdeTexto,
  mesSiguiente,
  primerDia,
  ultimoDia,
  type MesCalendario,
} from "./mes-calendario";

const m = (texto: string): MesCalendario => {
  const r = mesCalendarioDesdeTexto(texto);
  if (!r.ok) throw new Error(texto);
  return r.valor;
};

describe("mes calendario", () => {
  it.each(["2026-01", "2026-12", "0001-01", "9999-12"])("acepta %s", (texto) => {
    expect(mesCalendarioDesdeTexto(texto)).toEqual({ ok: true, valor: texto });
  });

  it.each([
    "",
    "2026-00",
    "2026-13",
    "2026-1",
    "2026-01-01",
    "0000-05",
    " 2026-01",
    "2026-01\n",
    "abcd-ef",
  ])("rechaza %j", (texto) => {
    expect(mesCalendarioDesdeTexto(texto)).toEqual({ ok: false, error: "MES_CALENDARIO_INVALIDO" });
  });

  it.each([
    ["2026-01", 31],
    ["2026-02", 28],
    ["2024-02", 29],
    ["2100-02", 28],
    ["2000-02", 29],
    ["2026-03", 31],
    ["2026-04", 30],
    ["2026-05", 31],
    ["2026-06", 30],
    ["2026-07", 31],
    ["2026-08", 31],
    ["2026-09", 30],
    ["2026-10", 31],
    ["2026-11", 30],
    ["2026-12", 31],
    ["9999-12", 31],
    ["0001-01", 31],
  ] as const)("%s tiene %i días", (mes, dias) => {
    expect(diasDelMes(m(mes))).toBe(dias);
  });

  it("primer y último día son fechas civiles reales de ese mes", () => {
    for (const mes of ["2024-02", "2026-02", "2026-11", "9999-12", "0001-02"]) {
      const primero = primerDia(m(mes));
      const ultimo = ultimoDia(m(mes));
      expect(primero).toBe(`${mes}-01`);
      expect(fechaCivilDesdeTexto(ultimo).ok).toBe(true);
      expect(ultimo).toBe(`${mes}-${String(diasDelMes(m(mes))).padStart(2, "0")}`);
    }
    expect(ultimoDia(m("2024-02"))).toBe("2024-02-29");
  });

  it("mes siguiente y anterior cruzan el año y avisan en los extremos", () => {
    expect(mesSiguiente(m("2026-12"))).toEqual({ ok: true, valor: "2027-01" });
    expect(mesSiguiente(m("2026-05"))).toEqual({ ok: true, valor: "2026-06" });
    expect(mesAnterior(m("2027-01"))).toEqual({ ok: true, valor: "2026-12" });
    expect(mesAnterior(m("2026-05"))).toEqual({ ok: true, valor: "2026-04" });
    expect(mesSiguiente(m("0099-12"))).toEqual({ ok: true, valor: "0100-01" });
    expect(mesSiguiente(m("0001-01"))).toEqual({ ok: true, valor: "0001-02" });
    expect(mesAnterior(m("0100-01"))).toEqual({ ok: true, valor: "0099-12" });
    expect(mesAnterior(m("0001-02"))).toEqual({ ok: true, valor: "0001-01" });
    expect(mesSiguiente(m("9999-12"))).toEqual({ ok: false, error: "MES_CALENDARIO_INVALIDO" });
    expect(mesAnterior(m("0001-01"))).toEqual({ ok: false, error: "MES_CALENDARIO_INVALIDO" });
  });

  it("contiene solo las fechas del mes", () => {
    expect(contiene(m("2026-02"), "2026-02-01" as FechaCivil)).toBe(true);
    expect(contiene(m("2026-02"), "2026-02-28" as FechaCivil)).toBe(true);
    expect(contiene(m("2026-02"), "2026-03-01" as FechaCivil)).toBe(false);
    expect(contiene(m("2026-02"), "2025-02-10" as FechaCivil)).toBe(false);
  });
});
