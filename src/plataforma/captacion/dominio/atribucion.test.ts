import { describe, expect, it } from "vitest";
import {
  CLAVES_DE_ATRIBUCION,
  LARGO_MAXIMO_DE_ATRIBUCION,
  normalizarAtribucion,
} from "./atribucion";

describe("normalizarAtribucion", () => {
  it("las claves son las seis de la lista cerrada, en este orden", () => {
    expect(CLAVES_DE_ATRIBUCION).toEqual([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "fbclid",
    ]);
    expect(LARGO_MAXIMO_DE_ATRIBUCION).toBe(200);
  });

  it("guarda las claves de campaña tal cual cuando ya tienen la forma permitida", () => {
    const crudo = {
      utm_source: "meta",
      utm_medium: "cpc",
      utm_campaign: "verano.2026_v-1~a",
      utm_content: "video1",
      utm_term: "cafeteria",
    };
    expect(normalizarAtribucion(crudo, false)).toEqual(crudo);
  });

  it("sin nada, o con nada de la lista, no guarda nada", () => {
    expect(normalizarAtribucion({}, true)).toEqual({});
    expect(normalizarAtribucion({ otra: "x", gclid: "y", UTM_SOURCE: "z" }, true)).toEqual({});
  });

  it("ignora toda clave que no es de la lista, aun con valor válido", () => {
    expect(
      normalizarAtribucion({ utm_id: "1", utm_source: "meta", email: "a@b.com" }, true),
    ).toEqual({ utm_source: "meta" });
  });

  it("una campaña con espacios o acentos no se pierde: cada tramo no permitido pasa a un guion", () => {
    expect(normalizarAtribucion({ utm_campaign: "Promo Verano" }, false)).toEqual({
      utm_campaign: "Promo-Verano",
    });
    expect(normalizarAtribucion({ utm_campaign: "campaña  de   verano!!" }, false)).toEqual({
      utm_campaign: "campa-a-de-verano",
    });
    expect(normalizarAtribucion({ utm_campaign: "a/b?c=d&e" }, false)).toEqual({
      utm_campaign: "a-b-c-d-e",
    });
  });

  it("saca los guiones de los dos bordes (los que pone la limpieza y los que ya venían), no los del medio", () => {
    expect(normalizarAtribucion({ utm_source: "  meta  " }, false)).toEqual({ utm_source: "meta" });
    expect(normalizarAtribucion({ utm_source: "--meta--" }, false)).toEqual({ utm_source: "meta" });
    expect(normalizarAtribucion({ utm_source: "-- a--b --" }, false)).toEqual({
      utm_source: "a--b",
    });
    expect(normalizarAtribucion({ utm_source: "-meta" }, false)).toEqual({ utm_source: "meta" });
    expect(normalizarAtribucion({ utm_source: "meta-" }, false)).toEqual({ utm_source: "meta" });
  });

  it("descarta lo que queda vacío después de limpiar", () => {
    expect(normalizarAtribucion({ utm_source: "" }, false)).toEqual({});
    expect(normalizarAtribucion({ utm_source: "   " }, false)).toEqual({});
    expect(normalizarAtribucion({ utm_source: "ñ¿?" }, false)).toEqual({});
    expect(normalizarAtribucion({ utm_source: "---" }, false)).toEqual({});
  });

  it("corta a 200 caracteres: 200 entran enteros, 201 se cortan", () => {
    const doscientos = "a".repeat(200);
    expect(normalizarAtribucion({ utm_term: doscientos }, false)).toEqual({ utm_term: doscientos });
    expect(normalizarAtribucion({ utm_term: `${doscientos}b` }, false)).toEqual({
      utm_term: doscientos,
    });
    expect(normalizarAtribucion({ utm_term: "x".repeat(5000) }, false)).toEqual({
      utm_term: "x".repeat(200),
    });
  });

  it("fbclid solo se guarda con consentimiento de medición", () => {
    expect(normalizarAtribucion({ fbclid: "IwAR0abc_def-123" }, true)).toEqual({
      fbclid: "IwAR0abc_def-123",
    });
    expect(normalizarAtribucion({ fbclid: "IwAR0abc_def-123", utm_source: "meta" }, false)).toEqual(
      {
        utm_source: "meta",
      },
    );
  });

  it("fbclid se guarda tal cual o no se guarda: ni se limpia ni se corta", () => {
    expect(normalizarAtribucion({ fbclid: " abc " }, true)).toEqual({ fbclid: "abc" });
    expect(normalizarAtribucion({ fbclid: "a b" }, true)).toEqual({});
    expect(normalizarAtribucion({ fbclid: "ñandú" }, true)).toEqual({});
    expect(normalizarAtribucion({ fbclid: "" }, true)).toEqual({});
    expect(normalizarAtribucion({ fbclid: "f".repeat(200) }, true)).toEqual({
      fbclid: "f".repeat(200),
    });
    expect(normalizarAtribucion({ fbclid: "f".repeat(201) }, true)).toEqual({});
    expect(normalizarAtribucion({ fbclid: "a\nb" }, true)).toEqual({});
  });

  it("una clave con valor indefinido se ignora y las demás siguen", () => {
    expect(normalizarAtribucion({ utm_source: undefined, utm_medium: "cpc" }, true)).toEqual({
      utm_medium: "cpc",
    });
  });

  it("las claves salen en el orden de la lista aunque lleguen mezcladas", () => {
    const resultado = normalizarAtribucion(
      { fbclid: "z", utm_term: "t", utm_source: "s", utm_campaign: "c" },
      true,
    );
    expect(Object.keys(resultado)).toEqual(["utm_source", "utm_campaign", "utm_term", "fbclid"]);
  });

  it("una clave peligrosa como __proto__ no contamina nada", () => {
    const crudo = JSON.parse('{"__proto__": "x", "utm_source": "meta"}') as Record<string, string>;
    const resultado = normalizarAtribucion(crudo, true);
    expect(resultado).toEqual({ utm_source: "meta" });
    expect(Object.getPrototypeOf(resultado)).toBe(Object.prototype);
  });
});
