import { describe, expect, it } from "vitest";
import { importeVigenteDeLinea, totalDeCompra, type LineaParaImporte } from "./importe-vigente";

const linea: LineaParaImporte = {
  unidadDeCompraId: "KILOGRAMO",
  cantidadDeCompra: "10",
  pesoReal: null,
  precioPorTipo: "UNIDAD",
  unidadDePrecioId: "KILOGRAMO",
  importe: "1000.00",
};
const kilo = { unidadBase: "KILOGRAMO", presentacion: null } as const;
const valor = (r: ReturnType<typeof importeVigenteDeLinea>) => {
  if (!r.ok) throw new Error(r.error);
  return r.valor;
};

describe("importeVigenteDeLinea", () => {
  it("sin corrección es el importe guardado, sin recalcular (ni pedir el producto)", () => {
    expect(valor(importeVigenteDeLinea(linea, null, null))).toBe("1000.00");
  });

  it("sin precio y sin corrección es null, nunca cero", () => {
    const sin = { ...linea, precioPorTipo: null, unidadDePrecioId: null, importe: null };
    expect(valor(importeVigenteDeLinea(sin, null, null))).toBeNull();
  });

  it("con corrección recalcula con el precio nuevo y deja intacto lo guardado", () => {
    expect(valor(importeVigenteDeLinea(linea, { precioNuevo: "120" }, kilo))).toBe("1200.00");
    expect(linea.importe).toBe("1000.00");
  });

  it("un solo redondeo: 3 × 0,335 es 1,01 (1,005 redondeado una vez), igual que el alta", () => {
    const tres = { ...linea, cantidadDeCompra: "3", importe: "0.00" };
    expect(valor(importeVigenteDeLinea(tres, { precioNuevo: "0.335" }, kilo))).toBe("1.01");
  });

  it("peso variable cobrado por kilo: usa el peso real, no el aproximado", () => {
    const caja = {
      ...linea,
      cantidadDeCompra: "2",
      pesoReal: "46.6",
      importe: "1.00",
    };
    const producto = {
      unidadBase: "KILOGRAMO",
      presentacion: { cantidadEnBase: "23.5", dePesoVariable: true },
    } as const;
    expect(valor(importeVigenteDeLinea(caja, { precioNuevo: "11000" }, producto))).toBe(
      "512600.00",
    );
  });

  it("una corrección sin precio nuevo deja la línea «Sin precio»", () => {
    expect(valor(importeVigenteDeLinea(linea, { precioNuevo: null }, kilo))).toBeNull();
  });

  it("una corrección sin precio nuevo da «Sin precio» aunque falten el producto y el tipo de precio", () => {
    const sinTipo = { ...linea, precioPorTipo: null };
    expect(valor(importeVigenteDeLinea(sinTipo, { precioNuevo: null }, null))).toBeNull();
  });

  it("con corrección y sin producto falla cerrado", () => {
    const r = importeVigenteDeLinea(linea, { precioNuevo: "120" }, null);
    expect(r).toEqual({ ok: false, error: "FALTA_EL_PRODUCTO" });
  });

  it("con precio nuevo y sin tipo de precio guardado falla cerrado", () => {
    const sinTipo = { ...linea, precioPorTipo: null };
    const r = importeVigenteDeLinea(sinTipo, { precioNuevo: "120" }, kilo);
    expect(r).toEqual({ ok: false, error: "LINEA_CORREGIDA_SIN_PRECIO_POR" });
  });

  it("propaga el error de la cuenta (precio inválido)", () => {
    const r = importeVigenteDeLinea(linea, { precioNuevo: "0" }, kilo);
    expect(r).toEqual({ ok: false, error: "PRECIO_INVALIDO" });
  });
});

describe("totalDeCompra", () => {
  it("suma en centavos exactos, sin errores de coma flotante", () => {
    expect(totalDeCompra(["0.10", "0.20"])).toBe("0.30");
    expect(totalDeCompra(["1000.00", "512600.00", "0.01"])).toBe("513600.01");
  });

  it("es null si alguna línea no tiene precio: nunca un total parcial ni cero", () => {
    expect(totalDeCompra(["10.00", null])).toBeNull();
    expect(totalDeCompra([null])).toBeNull();
  });

  it("es null si no hay líneas o si un importe no es un decimal de pesos", () => {
    expect(totalDeCompra([])).toBeNull();
    expect(totalDeCompra(["10.00", "abc"])).toBeNull();
  });
});
