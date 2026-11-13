import { describe, expect, it } from "vitest";
import {
  ALICUOTAS_DEL_PRODUCTO,
  CODIGOS_DE_ALICUOTA,
  esAlicuotaDelProducto,
  esCodigoDeAlicuota,
  porcentajeDeAlicuota,
} from "./alicuota";

describe("alícuotas del producto", () => {
  it("son las seis con IVA, en el orden de la maqueta, sin EXENTO ni NO_GRAVADO", () => {
    expect(ALICUOTAS_DEL_PRODUCTO).toEqual(["21", "10.5", "27", "5", "2.5", "0"]);
  });

  it("son exactamente los códigos de ARCA que llevan IVA: un código nuevo obliga a decidir si se ofrece", () => {
    const conIva = CODIGOS_DE_ALICUOTA.filter((c) => porcentajeDeAlicuota(c) !== null);
    expect([...ALICUOTAS_DEL_PRODUCTO].sort()).toEqual([...conIva].sort());
  });

  it("no ofrece las que no llevan IVA, aunque el servidor las acepte", () => {
    for (const c of ["EXENTO", "NO_GRAVADO"]) {
      expect(esAlicuotaDelProducto(c)).toBe(false);
      expect(esCodigoDeAlicuota(c)).toBe(true);
    }
  });

  it("rechaza lo que no es una alícuota, sin normalizar", () => {
    for (const c of ["", "21.0", "21 ", "10,5", "iva", "-1"]) {
      expect(esAlicuotaDelProducto(c)).toBe(false);
    }
    for (const c of ALICUOTAS_DEL_PRODUCTO) expect(esAlicuotaDelProducto(c)).toBe(true);
  });
});
