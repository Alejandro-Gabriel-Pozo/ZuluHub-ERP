import { describe, expect, it } from "vitest";
import { detalleDeLaDevolucionDeStock, renglonesParaStock } from "./stock-de-la-venta";

const base = {
  posicion: 1,
  productoId: "11111111-1111-4111-8111-111111111111",
  cantidad: "2.0000",
  unidadDeVenta: "UNIDAD",
  varianteOpcionId: null,
  varianteVersionDeOpcionId: null,
  opciones: [],
};

describe("renglonesParaStock", () => {
  it("arma un renglón por línea, en el orden dado, con la cantidad en texto decimal canónico y la unidad de venta", () => {
    const r = renglonesParaStock([
      base,
      { ...base, posicion: 2, productoId: "22222222-2222-4222-8222-222222222222", cantidad: "0.5" },
    ]);
    expect(r).toEqual({
      ok: true,
      valor: [
        {
          posicion: 1,
          productoId: "11111111-1111-4111-8111-111111111111",
          cantidad: "2.0000",
          unidadDeVentaId: "UNIDAD",
          opciones: [],
        },
        {
          posicion: 2,
          productoId: "22222222-2222-4222-8222-222222222222",
          cantidad: "0.5000",
          unidadDeVentaId: "UNIDAD",
          opciones: [],
        },
      ],
    });
  });

  it("una línea sin variante no lleva versión de variante (ni la clave)", () => {
    const r = renglonesParaStock([base]);
    expect(r.ok && Object.keys(r.valor[0] ?? {})).not.toContain("varianteVersionDeOpcionId");
  });

  it("una línea con variante lleva la versión SELLADA, y las opciones solo con su versión (sin lo que el ticket guarda de más)", () => {
    const r = renglonesParaStock([
      {
        ...base,
        varianteOpcionId: "33333333-3333-4333-8333-333333333333",
        varianteVersionDeOpcionId: "44444444-4444-4444-8444-444444444444",
        opciones: [
          { versionDeOpcionId: "55555555-5555-4555-8555-555555555555", nombre: "Queso" } as never,
          { versionDeOpcionId: "66666666-6666-4666-8666-666666666666" },
        ],
      },
    ]);
    expect(r).toEqual({
      ok: true,
      valor: [
        {
          posicion: 1,
          productoId: "11111111-1111-4111-8111-111111111111",
          cantidad: "2.0000",
          unidadDeVentaId: "UNIDAD",
          varianteVersionDeOpcionId: "44444444-4444-4444-8444-444444444444",
          opciones: [
            { versionDeOpcionId: "55555555-5555-4555-8555-555555555555" },
            { versionDeOpcionId: "66666666-6666-4666-8666-666666666666" },
          ],
        },
      ],
    });
  });

  it("una variante sin la versión sellada (línea anterior a 0036) no se explota con un factor supuesto: falla cerrado", () => {
    expect(
      renglonesParaStock([
        base,
        { ...base, posicion: 2, varianteOpcionId: "33333333-3333-4333-8333-333333333333" },
      ]),
    ).toEqual({ ok: false, error: "VARIANTE_SIN_VERSION_SELLADA" });
  });

  it("sin líneas no hay renglones", () => {
    expect(renglonesParaStock([])).toEqual({ ok: true, valor: [] });
  });
});

describe("detalleDeLaDevolucionDeStock", () => {
  it("es solo el número del ticket: el motivo que escribe quien anula no viaja a stock", () => {
    expect(detalleDeLaDevolucionDeStock(7)).toBe("Anulación del ticket 7");
    expect(detalleDeLaDevolucionDeStock(1234)).toBe("Anulación del ticket 1234");
  });
});
