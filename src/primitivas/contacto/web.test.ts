import { describe, expect, it } from "vitest";
import { LARGO_MAXIMO_DE_LA_WEB, webDesdeTexto } from "./web";

const MALA = { ok: false, error: "WEB_INVALIDA" } as const;

describe("web", () => {
  it("empieza con http:// o https:// (sin distinguir mayúsculas) y se limpia en los extremos", () => {
    expect(webDesdeTexto(" https://hotel.com/centro ")).toEqual({
      ok: true,
      valor: "https://hotel.com/centro",
    });
    expect(webDesdeTexto("http://hotel.com").ok).toBe(true);
    expect(webDesdeTexto("HTTPS://HOTEL.COM")).toEqual({ ok: true, valor: "HTTPS://HOTEL.COM" });
  });

  it("no se completa ni se adivina: sin esquema, con otro esquema o sin nada después se rechaza", () => {
    for (const mala of [
      "",
      "  ",
      "www.hotel.com",
      "hotel.com",
      "https://",
      "http:// ",
      "ftp://hotel.com",
      "//hotel.com",
    ]) {
      expect(webDesdeTexto(mala), JSON.stringify(mala)).toEqual(MALA);
    }
  });

  it("sin blancos ni caracteres de control adentro", () => {
    for (const mala of [
      "https://ho tel.com",
      "https://hotel.com\n/x",
      "https://hotel.com/\u0085",
      "https://a\u0000b",
    ]) {
      expect(webDesdeTexto(mala), JSON.stringify(mala)).toEqual(MALA);
    }
  });

  it("el borde: 200 caracteres entran y 201 no", () => {
    const de = (n: number) => `https://${"a".repeat(n - 8)}`;
    expect(webDesdeTexto(de(LARGO_MAXIMO_DE_LA_WEB)).ok).toBe(true);
    expect(webDesdeTexto(de(LARGO_MAXIMO_DE_LA_WEB + 1))).toEqual(MALA);
  });
});
