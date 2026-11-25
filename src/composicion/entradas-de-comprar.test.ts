import { describe, expect, it } from "vitest";
import {
  entradaDeCotizarCompra,
  entradaDeProductosParaComprar,
  entradaDeRegistrarCompra,
} from "./entradas-de-comprar";

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

describe("entradaDeRegistrarCompra", () => {
  const ID = "0b0b0b0b-1111-4222-8333-444444444444";
  const CLAVE = "5a5a5a5a-1111-4222-8333-444444444444";
  const renglon = {
    productoId: ID,
    unidadDeCompraId: "KILOGRAMO",
    cantidad: "2.5",
    precioPor: "UNIDAD",
    unidadDePrecioId: "KILOGRAMO",
    precio: "1234.50",
  };
  const pedido = { clave: CLAVE, proveedorId: ID, renglones: [renglon] };

  it("toma la clave, el proveedor y los renglones, y no inventa remito, depósito ni factura", () => {
    expect(entradaDeRegistrarCompra(pedido)).toEqual({
      ok: true,
      valor: {
        clave: CLAVE,
        proveedorId: ID,
        depositoId: null,
        remito: null,
        renglones: [{ ...renglon, presentacionId: null, pesoReal: null }],
        factura: null,
      },
    });
  });

  it("un remito todo en blanco es «sin remito»", () => {
    expect(
      entradaDeRegistrarCompra({ ...pedido, remito: { puntoDeVenta: "", numero: " ", fecha: "" } }),
    ).toMatchObject({ ok: true, valor: { remito: null } });
  });

  it("un remito completo llega con el punto de venta y el número como enteros", () => {
    expect(
      entradaDeRegistrarCompra({
        ...pedido,
        remito: { puntoDeVenta: "2", numero: "7842", fecha: "2026-11-05" },
      }),
    ).toMatchObject({
      ok: true,
      valor: { remito: { puntoDeVenta: 2, numero: 7842, fecha: "2026-11-05" } },
    });
  });

  it.each([
    { puntoDeVenta: "2", numero: "", fecha: "" },
    { puntoDeVenta: "", numero: "7842", fecha: "2026-11-05" },
    { puntoDeVenta: "2x", numero: "7842", fecha: "2026-11-05" },
    { puntoDeVenta: "-2", numero: "7842", fecha: "2026-11-05" },
    { puntoDeVenta: "2", numero: "1e3", fecha: "2026-11-05" },
  ])(
    "un remito a medio llenar o mal escrito (%j) se rechaza: no se guarda la compra sin él",
    (remito) => {
      expect(entradaDeRegistrarCompra({ ...pedido, remito })).toMatchObject({ ok: false });
    },
  );

  it.each([
    { ...pedido, clave: "no-es-un-uuid" },
    { ...pedido, proveedorId: "no-es-un-uuid" },
    { ...pedido, depositoId: "no-es-un-uuid" },
    { ...pedido, renglones: [] },
    { clave: CLAVE, proveedorId: ID },
    { ...pedido, renglones: [{ ...renglon, cantidad: 2.5 }] },
    { ...pedido, renglones: [{ ...renglon, precio: 1234.5 }] },
    { ...pedido, renglones: [{ ...renglon, precioPor: "CAJA" }] },
    { ...pedido, renglones: [{ ...renglon, unidadDeCompraId: "PARSEC" }] },
  ])("un pedido sin la forma pedida (%j) es un dato inválido", (crudo) => {
    expect(entradaDeRegistrarCompra(crudo)).toMatchObject({ ok: false });
  });

  it("ignora lo que el navegador mande de más: la empresa, la persona y la sucursal las pone el servidor", () => {
    const r = entradaDeRegistrarCompra({
      ...pedido,
      empresaId: "otra",
      personaId: "otra",
      sucursalId: ID,
      hechoEn: "2020-01-01T00:00:00Z",
      pago: { medio: "EFECTIVO" },
    });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(Object.keys(r.valor).sort()).toEqual([
        "clave",
        "depositoId",
        "factura",
        "proveedorId",
        "remito",
        "renglones",
      ]);
      expect(r.valor.factura).toBeNull();
    }
  });
});

describe("entradaDeRegistrarCompra: la factura («Con factura», Compras PR 7)", () => {
  const ID = "0b0b0b0b-1111-4222-8333-444444444444";
  const factura = {
    tipo: "FACTURA_A",
    puntoDeVenta: "5",
    numero: "1187",
    fecha: "2026-10-31",
    vencimientoDePago: "",
    lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1.5", alicuota: "21" }],
    percepciones: "",
    totalSegunFactura: "3630.00",
    cuitDelProveedor: "",
    condicionIva: "",
  };
  const pedido = (extra: Record<string, unknown> = {}) => ({
    clave: ID,
    proveedorId: ID,
    renglones: [
      {
        productoId: ID,
        unidadDeCompraId: "KILOGRAMO",
        cantidad: "2",
        precioPor: "UNIDAD",
        unidadDePrecioId: "KILOGRAMO",
        precio: "1000",
      },
    ],
    ...extra,
  });

  it("toma la factura campo por campo: punto de venta y número como enteros, importes y cantidades como TEXTO, y los opcionales en blanco son «no hay»", () => {
    const r = entradaDeRegistrarCompra(pedido({ factura }));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.valor.factura).toEqual({
      tipo: "FACTURA_A",
      puntoDeVenta: 5,
      numero: 1187,
      fecha: "2026-10-31",
      vencimientoDePago: null,
      lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1.5", alicuota: "21" }],
      percepciones: null,
      totalSegunFactura: "3630.00",
      cuitDelProveedor: null,
      condicionIva: null,
    });
  });

  it("una línea sin alícuota (comprobante B o C) llega con alícuota nula; el CUIT y la condición de la primera factura llegan tal cual", () => {
    const r = entradaDeRegistrarCompra(
      pedido({
        factura: {
          ...factura,
          tipo: "FACTURA_C",
          lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1.5" }],
          cuitDelProveedor: "20123456786",
          condicionIva: "MONOTRIBUTO",
          percepciones: "10.50",
          vencimientoDePago: "2026-11-30",
        },
      }),
    );
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.valor.factura).toMatchObject({
      lineas: [{ alicuota: null }],
      cuitDelProveedor: "20123456786",
      condicionIva: "MONOTRIBUTO",
      percepciones: "10.50",
      vencimientoDePago: "2026-11-30",
    });
  });

  it.each([
    ["un campo de más (pago)", { pago: { medio: "TRANSFERENCIA" } }],
    ["el total calculado", { totalCalculado: "3630.00" }],
    ["la empresa", { empresaId: ID }],
    ["una moneda", { moneda: "USD" }],
    ["un tipo que no es de la lista", { tipo: "FACTURA_Z" }],
    [
      "una alícuota que no es de la lista",
      { lineas: [{ renglon: 1, cantidadFacturada: "1", precioNeto: "1", alicuota: "99" }] },
    ],
    [
      "una línea con un campo de más",
      { lineas: [{ renglon: 1, cantidadFacturada: "1", precioNeto: "1", importe: "5" }] },
    ],
    ["un punto de venta decimal", { puntoDeVenta: "5.5" }],
    ["un número negativo", { numero: "-1" }],
    ["un total que es número", { totalSegunFactura: 3630 }],
    ["una factura sin líneas", { lineas: [] }],
  ])("rechaza %s", (_nombre, cambios) => {
    expect(entradaDeRegistrarCompra(pedido({ factura: { ...factura, ...cambios } })).ok).toBe(
      false,
    );
  });

  it("sin factura (o con factura nula) es «sin factura»", () => {
    for (const extra of [{}, { factura: null }]) {
      const r = entradaDeRegistrarCompra(pedido(extra));
      expect(r).toMatchObject({ ok: true });
      if (r.ok) expect(r.valor.factura).toBeNull();
    }
  });
});
