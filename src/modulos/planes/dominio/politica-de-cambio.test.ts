import { describe, expect, it } from "vitest";
import { hoyEnArgentina } from "../../../primitivas/tiempo/fecha-civil-hasta-hoy";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import {
  decidirArrepentimiento,
  decidirCondiciones,
  sentidoDelCambio,
  type PoliticaDeCambioDePlan,
} from "./politica-de-cambio";

const fecha = (texto: string): FechaCivil => {
  const f = fechaCivilDesdeTexto(texto);
  if (!f.ok) throw new Error(texto);
  return f.valor;
};
const POLITICA = (suba: number, baja: number, arrepentimiento: number): PoliticaDeCambioDePlan => ({
  version: 1,
  diasDeAnticipacionDeSuba: suba,
  diasDeAnticipacionDeBaja: baja,
  diasDeArrepentimiento: arrepentimiento,
});
const HOY = fecha("2026-11-19");

describe("sentidoDelCambio", () => {
  it("sin módulos que salgan ni perillas que bajen es SUBA", () => {
    expect(sentidoDelCambio({ modulosQueSalen: [], perillas: [] })).toBe("SUBA");
    expect(sentidoDelCambio({ modulosQueSalen: [], perillas: [{ sentido: "SUBE" }] })).toBe("SUBA");
  });
  it("un módulo que sale es BAJA", () => {
    expect(sentidoDelCambio({ modulosQueSalen: ["caja"], perillas: [] })).toBe("BAJA");
  });
  it("una perilla que baja es BAJA", () => {
    expect(sentidoDelCambio({ modulosQueSalen: [], perillas: [{ sentido: "BAJA" }] })).toBe("BAJA");
  });
  it("mixto (sube unas cosas y baja otras) es BAJA", () => {
    expect(
      sentidoDelCambio({
        modulosQueSalen: [],
        perillas: [{ sentido: "SUBE" }, { sentido: "BAJA" }],
      }),
    ).toBe("BAJA");
  });
});

describe("decidirCondiciones", () => {
  const decidir = (
    vigenteDesde: string,
    sentido: "SUBA" | "BAJA",
    politica: PoliticaDeCambioDePlan,
  ) => decidirCondiciones({ hoy: HOY, vigenteDesde: fecha(vigenteDesde), sentido, politica });

  it("suba: el día justo pasa y un día antes no (con la primera fecha válida)", () => {
    expect(decidir("2026-11-22", "SUBA", POLITICA(3, 1, 0))).toEqual({
      ok: true,
      valor: { arrepentimientoHasta: null },
    });
    expect(decidir("2026-11-21", "SUBA", POLITICA(3, 1, 0))).toEqual({
      ok: false,
      error: { codigo: "ANTICIPACION_INSUFICIENTE", primeraFechaValida: "2026-11-22" },
    });
  });

  it("baja: manda la anticipación de baja si es mayor que el arrepentimiento", () => {
    expect(decidir("2026-11-24", "BAJA", POLITICA(0, 5, 2)).ok).toBe(true);
    expect(decidir("2026-11-23", "BAJA", POLITICA(0, 5, 2))).toEqual({
      ok: false,
      error: { codigo: "ANTICIPACION_INSUFICIENTE", primeraFechaValida: "2026-11-24" },
    });
  });

  it("baja: manda el plazo de arrepentimiento si es mayor que la anticipación de baja", () => {
    expect(decidir("2026-11-22", "BAJA", POLITICA(0, 1, 3)).ok).toBe(true);
    expect(decidir("2026-11-21", "BAJA", POLITICA(0, 1, 3))).toEqual({
      ok: false,
      error: { codigo: "ANTICIPACION_INSUFICIENTE", primeraFechaValida: "2026-11-22" },
    });
  });

  it("la suba no mira la anticipación de baja ni la baja la de suba", () => {
    expect(decidir("2026-11-20", "SUBA", POLITICA(1, 9, 0)).ok).toBe(true);
    expect(decidir("2026-11-20", "BAJA", POLITICA(9, 1, 0)).ok).toBe(true);
  });

  it("con arrepentimiento 0 no hay fecha límite; con N días es hoy + N (inclusive)", () => {
    expect(decidir("2026-11-20", "SUBA", POLITICA(1, 1, 0))).toEqual({
      ok: true,
      valor: { arrepentimientoHasta: null },
    });
    expect(decidir("2026-11-20", "SUBA", POLITICA(1, 1, 3))).toEqual({
      ok: true,
      valor: { arrepentimientoHasta: "2026-11-22" },
    });
  });

  it("cruza el fin de mes y de año", () => {
    const fin = decidirCondiciones({
      hoy: fecha("2026-12-30"),
      vigenteDesde: fecha("2027-01-01"),
      sentido: "SUBA",
      politica: POLITICA(3, 1, 0),
    });
    expect(fin).toEqual({
      ok: false,
      error: { codigo: "ANTICIPACION_INSUFICIENTE", primeraFechaValida: "2027-01-02" },
    });
  });

  it("el día civil de Argentina corta a las 00:00 (UTC-3): 23:59 y 00:00 son días distintos", () => {
    const antes = hoyEnArgentina(new Date("2026-11-20T02:59:00Z"));
    const despues = hoyEnArgentina(new Date("2026-11-20T03:00:00Z"));
    expect(antes).toEqual({ ok: true, valor: "2026-11-19" });
    expect(despues).toEqual({ ok: true, valor: "2026-11-20" });
  });
});

describe("fuera del calendario", () => {
  it("un «hoy» al borde del calendario no se redondea: es un dato corrupto y corta con su mensaje", () => {
    expect(() =>
      decidirCondiciones({
        hoy: fecha("9999-12-31"),
        vigenteDesde: fecha("9999-12-31"),
        sentido: "SUBA",
        politica: POLITICA(1, 1, 0),
      }),
    ).toThrow("la fecha 9999-12-31 más 1 días sale del calendario");
  });
});

describe("decidirArrepentimiento", () => {
  const base = {
    hoy: HOY,
    esElUltimo: true,
    origen: "CAMBIO" as const,
    condiciones: { arrepentimientoHasta: fecha("2026-11-19") },
    yaArrepentido: false,
  };
  it("el último día del plazo todavía se puede; al día siguiente no", () => {
    expect(decidirArrepentimiento(base)).toEqual({ ok: true, valor: null });
    expect(decidirArrepentimiento({ ...base, hoy: fecha("2026-11-20") })).toEqual({
      ok: false,
      error: { codigo: "PLAZO_VENCIDO" },
    });
  });
  it("un cambio ya arrepentido se rechaza primero, aunque ya no sea el último", () => {
    expect(decidirArrepentimiento({ ...base, yaArrepentido: true, esElUltimo: false })).toEqual({
      ok: false,
      error: { codigo: "YA_ARREPENTIDO" },
    });
  });
  it("si no es el último cambio, se rechaza", () => {
    expect(decidirArrepentimiento({ ...base, esElUltimo: false })).toEqual({
      ok: false,
      error: { codigo: "NO_ES_EL_ULTIMO_CAMBIO" },
    });
  });
  it("sin condiciones, con plazo 0 o de origen distinto de CAMBIO no admite arrepentimiento", () => {
    const sin = { ok: false, error: { codigo: "CAMBIO_SIN_ARREPENTIMIENTO" } };
    expect(decidirArrepentimiento({ ...base, condiciones: null })).toEqual(sin);
    expect(
      decidirArrepentimiento({ ...base, condiciones: { arrepentimientoHasta: null } }),
    ).toEqual(sin);
    expect(decidirArrepentimiento({ ...base, origen: "ALTA" })).toEqual(sin);
    expect(decidirArrepentimiento({ ...base, origen: "MIGRACION_DE_VERSION" })).toEqual(sin);
  });
});
