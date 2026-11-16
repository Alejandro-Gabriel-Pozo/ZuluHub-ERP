import { describe, expect, it } from "vitest";
import { DECIMALES_DE_CANTIDAD, ENTEROS_DE_CANTIDAD } from "./cantidad";
import {
  DECIMALES_DE_MERMA,
  ENTEROS_DE_MERMA,
  esMermaPermitida,
  FORMA_DE_LA_MERMA,
  mermaATexto,
  mermaDesdeTexto,
} from "./merma";
import { porcentajeDesdeTexto } from "./porcentaje";

describe("mermaDesdeTexto", () => {
  it.each([
    ["0", "0.0000"],
    ["10", "10.0000"],
    ["10.5", "10.5000"],
    ["0.0001", "0.0001"],
    ["99", "99.0000"],
    ["99.9999", "99.9999"],
    ["10.5000", "10.5000"],
  ])("«%s» es una merma permitida (%s)", (texto, canonico) => {
    const r = mermaDesdeTexto(texto);
    expect(r.ok && mermaATexto(r.valor)).toBe(canonico);
  });

  it.each([
    "100",
    "100.0000",
    "101",
    "1000",
    "-1",
    "+5",
    "5.",
    ".5",
    "5,5",
    "1.23456",
    "1e1",
    " 5",
    "5 ",
    "5\n",
    "",
    " ",
    "cinco",
    "0x10",
    "5%",
    "٥",
    "05",
    "00",
    "00.5",
  ])("«%j» se rechaza como MERMA_INVALIDA", (texto) => {
    expect(mermaDesdeTexto(texto)).toEqual({ ok: false, error: "MERMA_INVALIDA" });
  });

  it("lo que no es texto se rechaza, no se convierte", () => {
    for (const valor of [10, null, undefined, {}, ["10"]]) {
      expect(mermaDesdeTexto(valor as never)).toEqual({ ok: false, error: "MERMA_INVALIDA" });
    }
  });

  it("toda merma permitida es menor que 100 (la forma y el tope dicen lo mismo)", () => {
    const r = mermaDesdeTexto("99.9999");
    expect(r.ok && esMermaPermitida(r.valor)).toBe(true);
  });
});

describe("esMermaPermitida", () => {
  it("0 y 99,9999 sí; 100 no (un porcentaje llega hasta 100 inclusive, la merma no)", () => {
    expect(esMermaPermitida(porcentajeDesdeTexto("0"))).toBe(true);
    expect(esMermaPermitida(porcentajeDesdeTexto("99.9999"))).toBe(true);
    expect(esMermaPermitida(porcentajeDesdeTexto("100"))).toBe(false);
  });
});

describe("la forma y sus medidas", () => {
  it("2 enteros y 4 decimales; la forma las usa tal cual", () => {
    expect(ENTEROS_DE_MERMA).toBe(2);
    expect(DECIMALES_DE_MERMA).toBe(4);
    expect(FORMA_DE_LA_MERMA.test("99.9999")).toBe(true);
    expect(FORMA_DE_LA_MERMA.test("999.9999")).toBe(false);
    expect(FORMA_DE_LA_MERMA.test("99.99999")).toBe(false);
  });

  it("una cantidad admite 14 enteros y 4 decimales (`numeric(18,4)`)", () => {
    expect(ENTEROS_DE_CANTIDAD).toBe(14);
    expect(DECIMALES_DE_CANTIDAD).toBe(4);
  });
});
