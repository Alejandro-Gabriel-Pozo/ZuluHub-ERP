import { describe, expect, it } from "vitest";
import {
  claveDeLaAnulacionDelCargo,
  claveDeLaAnulacionDelPago,
  claveDeLaImputacionDelPago,
  claveDelCargo,
  claveDelPago,
  repartoPorDefecto,
} from "./cargo-de-factura";

const COMPROBANTE = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";

describe("las claves del cargo de una factura", () => {
  it("salen del comprobante: la misma factura, la misma clave; otra factura, otra", () => {
    expect(claveDelCargo(COMPROBANTE)).toBe(claveDelCargo(COMPROBANTE));
    expect(claveDelCargo(COMPROBANTE)).not.toBe(claveDelCargo(OTRO));
  });

  it("la del espejo es otra que la del cargo (no se pisan) y también sale del comprobante", () => {
    expect(claveDeLaAnulacionDelCargo(COMPROBANTE)).not.toBe(claveDelCargo(COMPROBANTE));
    expect(claveDeLaAnulacionDelCargo(COMPROBANTE)).toBe(claveDeLaAnulacionDelCargo(COMPROBANTE));
  });

  it("tienen la forma de clave de los libros (16 a 128 de A-Z a-z 0-9 _ -)", () => {
    for (const c of [claveDelCargo(COMPROBANTE), claveDeLaAnulacionDelCargo(COMPROBANTE)]) {
      expect(c).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    }
  });
});

describe("repartoPorDefecto", () => {
  it("todo el total a la sucursal dada, o a «sin centro de costo» (null) si la factura no tiene sucursal", () => {
    expect(repartoPorDefecto(OTRO, "2420.00")).toEqual([{ sucursalId: OTRO, importe: "2420.00" }]);
    expect(repartoPorDefecto(null, "2420.00")).toEqual([{ sucursalId: null, importe: "2420.00" }]);
  });
});

describe("las claves del pago de una factura en el libro", () => {
  it("salen del pago: el mismo pago, las mismas claves; otro pago, otras", () => {
    for (const clave of [claveDelPago, claveDeLaImputacionDelPago, claveDeLaAnulacionDelPago]) {
      expect(clave(COMPROBANTE)).toBe(clave(COMPROBANTE));
      expect(clave(COMPROBANTE)).not.toBe(clave(OTRO));
      expect(clave(COMPROBANTE)).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    }
  });

  it("el asiento, su imputación y su espejo tienen claves distintas entre sí y de las del cargo (no se pisan)", () => {
    const claves = [
      claveDelPago(COMPROBANTE),
      claveDeLaImputacionDelPago(COMPROBANTE),
      claveDeLaAnulacionDelPago(COMPROBANTE),
      claveDelCargo(COMPROBANTE),
      claveDeLaAnulacionDelCargo(COMPROBANTE),
    ];
    expect(new Set(claves).size).toBe(claves.length);
  });
});
