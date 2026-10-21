import { describe, expect, it } from "vitest";
import {
  fechaLegible,
  fechaMinimaDeVigencia,
  instanteDeVigencia,
} from "../../apps/plataforma/logica/vigencia";

describe("fechaMinimaDeVigencia", () => {
  it("usa el día argentino: a las 02:30Z todavía es 19", () => {
    expect(fechaMinimaDeVigencia(new Date("2026-10-20T02:30:00Z"))).toBe("2026-10-20");
  });
  it("a las 03:00Z ya es 20 en Argentina", () => {
    expect(fechaMinimaDeVigencia(new Date("2026-10-20T03:00:00Z"))).toBe("2026-10-21");
  });
  it("fin de mes y fin de año", () => {
    expect(fechaMinimaDeVigencia(new Date("2026-10-31T15:00:00Z"))).toBe("2026-11-01");
    expect(fechaMinimaDeVigencia(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
    expect(fechaMinimaDeVigencia(new Date("2027-01-01T01:00:00Z"))).toBe("2027-01-01");
  });
  it("fin de febrero bisiesto", () => {
    expect(fechaMinimaDeVigencia(new Date("2028-02-28T15:00:00Z"))).toBe("2028-02-29");
    expect(fechaMinimaDeVigencia(new Date("2027-02-28T15:00:00Z"))).toBe("2027-03-01");
  });
});

describe("instanteDeVigencia", () => {
  it("es la medianoche argentina", () => {
    expect(instanteDeVigencia("2026-11-01")?.toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });
  it("acepta el 29 de febrero solo en año bisiesto", () => {
    expect(instanteDeVigencia("2028-02-29")).not.toBeNull();
    expect(instanteDeVigencia("2027-02-29")).toBeNull();
  });
  it.each([
    "2026-02-30",
    "2026-13-01",
    "2026-00-10",
    "1999-12-31",
    "2101-01-01",
    "2026-1-1",
    "",
    "hola",
    "2026-11-01 ",
  ])("%j es inválida", (texto) => {
    expect(instanteDeVigencia(texto)).toBeNull();
  });
});

describe("fechaLegible", () => {
  it("formatea DD/MM/AAAA", () => {
    expect(fechaLegible("2026-11-01")).toBe("01/11/2026");
  });
  it("devuelve el texto tal cual si no es válida", () => {
    expect(fechaLegible("2026-02-30")).toBe("2026-02-30");
    expect(fechaLegible("x")).toBe("x");
  });
});
