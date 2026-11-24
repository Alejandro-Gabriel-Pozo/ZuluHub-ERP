import { describe, expect, it } from "vitest";
import { entradaDeCotizarCompra, entradaDeProductosParaComprar } from "./entradas-de-comprar";

describe("entradaDeProductosParaComprar", () => {
  it.each([undefined, {}, { texto: "" }, { texto: "   " }])(
    "sin texto (%j) es «sin filtro»",
    (crudo) => {
      expect(entradaDeProductosParaComprar(crudo)).toEqual({
        ok: true,
        valor: { ninguno: false, texto: undefined },
      });
    },
  );

  it("un texto válido pasa tal cual", () => {
    expect(entradaDeProductosParaComprar({ texto: "Harina 000" })).toEqual({
      ok: true,
      valor: { ninguno: false, texto: "Harina 000" },
    });
  });

  it.each(["a\u0000b", "<b>", "a​b", "x".repeat(121), "+uno"])(
    "un texto que la búsqueda no permite (%j) es «nada puede coincidir», no una búsqueda ancha",
    (texto) => {
      expect(entradaDeProductosParaComprar({ texto })).toEqual({
        ok: true,
        valor: { ninguno: true },
      });
    },
  );

  it.each([{ texto: 5 }, { texto: "x".repeat(1001) }, "texto"])(
    "un pedido sin la forma pedida (%j) es un dato inválido",
    (crudo) => {
      expect(entradaDeProductosParaComprar(crudo)).toMatchObject({ ok: false });
    },
  );

  it("ignora lo que el navegador mande de más (empresa, tope, clase)", () => {
    expect(
      entradaDeProductosParaComprar({
        texto: "sal",
        empresaId: "otra",
        limite: 9999,
        clase: "VENDIBLE",
      }),
    ).toEqual({ ok: true, valor: { ninguno: false, texto: "sal" } });
  });
});

describe("entradaDeCotizarCompra", () => {
  const ID = "0b0b0b0b-1111-4222-8333-444444444444";
  const renglon = {
    productoId: ID,
    unidadDeCompraId: "KILOGRAMO",
    cantidad: "2.5",
    precioPor: "UNIDAD",
    unidadDePrecioId: "KILOGRAMO",
    precio: "1234.5678",
  };

  it("toma solo los campos declarados, con cantidades y precio como texto, y sin presentación", () => {
    expect(
      entradaDeCotizarCompra({
        renglones: [{ ...renglon, presentacionId: ID, empresaId: "otra", importe: "1" }],
        sucursalId: ID,
      }),
    ).toEqual({
      ok: true,
      valor: {
        renglones: [
          {
            productoId: ID,
            presentacionId: null,
            unidadDeCompraId: "KILOGRAMO",
            cantidad: "2.5",
            pesoReal: null,
            precioPor: "UNIDAD",
            unidadDePrecioId: "KILOGRAMO",
            precio: "1234.5678",
          },
        ],
      },
    });
  });

  it("un precio ausente o nulo es «sin precio» (null), nunca cero", () => {
    const sin = entradaDeCotizarCompra({ renglones: [{ ...renglon, precio: null }] });
    expect(sin).toMatchObject({ ok: true, valor: { renglones: [{ precio: null }] } });
    const ausente = entradaDeCotizarCompra({
      renglones: [
        { productoId: ID, unidadDeCompraId: "KILOGRAMO", cantidad: "1", precioPor: "UNIDAD" },
      ],
    });
    expect(ausente).toMatchObject({ ok: true, valor: { renglones: [{ precio: null }] } });
  });

  it.each([
    ["number en la cantidad", { ...renglon, cantidad: 2.5 }],
    ["number en el precio", { ...renglon, precio: 10 }],
    ["producto que no es uuid", { ...renglon, productoId: "x" }],
    ["unidad inventada", { ...renglon, unidadDeCompraId: "PALADA" }],
    ["precioPor inventado", { ...renglon, precioPor: "BULTO" }],
    ["decimal enorme", { ...renglon, cantidad: "1".repeat(41) }],
  ])("%s es un dato inválido", (_n, r) => {
    expect(entradaDeCotizarCompra({ renglones: [r] })).toMatchObject({ ok: false });
  });

  it.each([undefined, {}, { renglones: [] }, { renglones: "x" }])(
    "sin renglones (%j) es un dato inválido",
    (crudo) => {
      expect(entradaDeCotizarCompra(crudo)).toMatchObject({ ok: false });
    },
  );
});
