import { describe, expect, it } from "vitest";
import { ALCANCES_DE_PRECIO, sucursalDelAlcanceDePrecio } from "./alcance-de-precio";

const SUCURSAL = "5f1c0f7e-2b1a-4c55-9d1e-0a5b6c7d8e9f";

describe("alcance de un precio", () => {
  it("son dos: empresa y sucursal", () => {
    expect(ALCANCES_DE_PRECIO).toEqual(["EMPRESA", "SUCURSAL"]);
  });

  it("«EMPRESA» da sucursal nula, llegue o no una sucursal", () => {
    expect(sucursalDelAlcanceDePrecio("EMPRESA", null)).toEqual({ ok: true, valor: null });
    expect(sucursalDelAlcanceDePrecio("EMPRESA", SUCURSAL)).toEqual({ ok: true, valor: null });
  });

  it("«SUCURSAL» da la sucursal elegida", () => {
    expect(sucursalDelAlcanceDePrecio("SUCURSAL", SUCURSAL)).toEqual({ ok: true, valor: SUCURSAL });
  });

  it("«SUCURSAL» sin sucursal elegida se rechaza y nunca se toma por la empresa", () => {
    for (const s of [null, ""]) {
      expect(sucursalDelAlcanceDePrecio("SUCURSAL", s)).toEqual({
        ok: false,
        error: "SUCURSAL_REQUERIDA",
      });
    }
  });

  it("«SUCURSAL» con un id que no es uuid se rechaza", () => {
    expect(sucursalDelAlcanceDePrecio("SUCURSAL", "norte")).toEqual({
      ok: false,
      error: "SUCURSAL_INVALIDA",
    });
  });

  it("un alcance que no es de la lista se rechaza, sin normalizar", () => {
    for (const a of ["", "empresa", "Empresa ", "TODAS", "sucursal"]) {
      expect(sucursalDelAlcanceDePrecio(a, SUCURSAL)).toEqual({
        ok: false,
        error: "ALCANCE_INVALIDO",
      });
    }
  });
});
