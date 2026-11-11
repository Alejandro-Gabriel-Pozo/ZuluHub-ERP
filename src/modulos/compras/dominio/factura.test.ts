import { describe, expect, it } from "vitest";
import {
  camposDeHuellaDeFactura,
  leerFactura,
  razonSocialDeLaParte,
  repartirConciliacionDeAtajo,
  tributosDeLaPantalla,
} from "./factura";

const linea = (extra: Record<string, unknown> = {}) => ({
  renglon: 1,
  cantidadFacturada: "2000",
  precioNeto: "1",
  alicuota: "21",
  ...extra,
});
const factura = (extra: Record<string, unknown> = {}) => ({
  tipo: "FACTURA_A",
  puntoDeVenta: 5,
  numero: 123,
  fecha: "2026-10-10",
  lineas: [linea()],
  totalSegunFactura: "2420.00",
  ...extra,
});

describe("leerFactura", () => {
  it("lee una factura completa y completa lo opcional con null", () => {
    const r = leerFactura(factura());
    expect(r).toEqual({
      ok: true,
      valor: {
        tipo: "FACTURA_A",
        puntoDeVenta: 5,
        numero: 123,
        fecha: "2026-10-10",
        vencimientoDePago: null,
        lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1", alicuota: "21" }],
        percepciones: null,
        totalSegunFactura: "2420.00",
        cuitDelProveedor: null,
        condicionIva: null,
      },
    });
  });
  it("conserva el vencimiento, las percepciones, el CUIT y la condición cuando vienen; una línea sin alícuota es null", () => {
    const r = leerFactura(
      factura({
        vencimientoDePago: "2026-11-10",
        percepciones: "10.00",
        cuitDelProveedor: "30-12345678-9",
        condicionIva: "MONOTRIBUTO",
        moneda: "ARS",
        lineas: [linea({ alicuota: undefined })],
      }),
    );
    expect(r.ok && r.valor).toMatchObject({
      vencimientoDePago: "2026-11-10",
      percepciones: "10.00",
      cuitDelProveedor: "30-12345678-9",
      condicionIva: "MONOTRIBUTO",
    });
    expect(r.ok && r.valor.lineas[0]?.alicuota).toBeNull();
  });
  it("acepta null explícito en lo opcional", () => {
    const r = leerFactura(
      factura({
        vencimientoDePago: null,
        percepciones: null,
        cuitDelProveedor: null,
        condicionIva: null,
        lineas: [linea({ alicuota: null })],
      }),
    );
    expect(r.ok && r.valor).toMatchObject({
      vencimientoDePago: null,
      percepciones: null,
      cuitDelProveedor: null,
      condicionIva: null,
    });
    expect(r.ok && r.valor.lineas[0]?.alicuota).toBeNull();
  });
  it("rechaza un tipo que no es de los nueve", () => {
    for (const tipo of ["FACTURA_Z", "", 5, undefined, "factura_a"]) {
      expect(leerFactura(factura({ tipo }))).toEqual({
        ok: false,
        error: "TIPO_DE_COMPROBANTE_INVALIDO",
      });
    }
  });
  it("rechaza el punto de venta y el número fuera de rango, no enteros o no numéricos", () => {
    for (const puntoDeVenta of [0, 99999, 1.5, "5", null, undefined]) {
      expect(leerFactura(factura({ puntoDeVenta }))).toEqual({
        ok: false,
        error: "PUNTO_DE_VENTA_INVALIDO",
      });
    }
    for (const numero of [0, 100000000, 1.5, "5", null, undefined]) {
      expect(leerFactura(factura({ numero }))).toEqual({
        ok: false,
        error: "NUMERO_DE_COMPROBANTE_INVALIDO",
      });
    }
    expect(leerFactura(factura({ puntoDeVenta: 99998, numero: 99999999 })).ok).toBe(true);
  });
  it("rechaza una fecha o un vencimiento que no son fechas civiles", () => {
    const engano = { toString: () => "2026-10-10" };
    for (const fecha of ["2026-02-30", "", null, undefined, 20261010, engano]) {
      expect(leerFactura(factura({ fecha }))).toEqual({ ok: false, error: "FECHA_INVALIDA" });
    }
    for (const vencimientoDePago of ["x", "2026-13-01", 5, engano]) {
      expect(leerFactura(factura({ vencimientoDePago }))).toEqual({
        ok: false,
        error: "FECHA_INVALIDA",
      });
    }
  });
  it("solo acepta pesos", () => {
    for (const moneda of ["USD", "", null, 1]) {
      expect(leerFactura(factura({ moneda }))).toEqual({ ok: false, error: "MONEDA_NO_SOPORTADA" });
    }
  });
  it("pide al menos una línea y no más de 9999", () => {
    for (const lineas of [[], undefined, null, "x", {}]) {
      expect(leerFactura(factura({ lineas }))).toEqual({ ok: false, error: "LINEAS_REQUERIDAS" });
    }
    expect(leerFactura(factura({ lineas: new Array(10_000).fill(linea()) }))).toEqual({
      ok: false,
      error: "RENGLONES_INVALIDOS",
    });
    expect(leerFactura(factura({ lineas: new Array(9_999).fill(linea()) })).ok).toBe(true);
  });
  it("rechaza una línea con cualquier campo de forma inválida", () => {
    const engano = { toString: () => "2" };
    for (const mala of [
      { renglon: 0 },
      { renglon: 1.5 },
      { renglon: "1" },
      { renglon: undefined },
      { cantidadFacturada: 2 },
      { cantidadFacturada: engano },
      { precioNeto: 1 },
      { alicuota: 21 },
    ]) {
      expect(leerFactura(factura({ lineas: [linea(mala)] }))).toEqual({
        ok: false,
        error: "RENGLONES_INVALIDOS",
      });
    }
    for (const cruda of [null, 3, "x", []]) {
      expect(leerFactura(factura({ lineas: [cruda] }))).toEqual({
        ok: false,
        error: "RENGLONES_INVALIDOS",
      });
    }
  });
  it("rechaza un total, unas percepciones, un CUIT o una condición que no son texto", () => {
    expect(leerFactura(factura({ totalSegunFactura: 2420 }))).toEqual({
      ok: false,
      error: "TOTAL_INVALIDO",
    });
    expect(leerFactura(factura({ totalSegunFactura: undefined }))).toEqual({
      ok: false,
      error: "TOTAL_INVALIDO",
    });
    expect(leerFactura(factura({ percepciones: 10 }))).toEqual({
      ok: false,
      error: "TOTAL_INVALIDO",
    });
    expect(leerFactura(factura({ cuitDelProveedor: 30123456789 }))).toEqual({
      ok: false,
      error: "CUIT_INVALIDO",
    });
    expect(leerFactura(factura({ condicionIva: 5 }))).toEqual({
      ok: false,
      error: "CUIT_INVALIDO",
    });
  });
  it("lo que no es un objeto es una factura sin tipo", () => {
    for (const v of [null, undefined, 3, "x", []]) {
      expect(leerFactura(v)).toEqual({ ok: false, error: "TIPO_DE_COMPROBANTE_INVALIDO" });
    }
  });
});

describe("camposDeHuellaDeFactura", () => {
  const leida = leerFactura(
    factura({
      vencimientoDePago: "2026-11-10",
      percepciones: "5",
      cuitDelProveedor: "30",
      condicionIva: "MONOTRIBUTO",
    }),
  );
  if (!leida.ok) throw new Error("factura de prueba inválida");
  it("aplana todos los campos en un orden fijo", () => {
    expect(camposDeHuellaDeFactura(leida.valor)).toEqual([
      "FACTURA_A",
      5,
      123,
      "2026-10-10",
      "2026-11-10",
      "5",
      "2420.00",
      "30",
      "MONOTRIBUTO",
      '[[1,"2000","1","21"]]',
    ]);
  });
});

describe("tributosDeLaPantalla", () => {
  it("una percepción es un tributo sin clasificar; vacía o en cero no es nada", () => {
    expect(tributosDeLaPantalla("12.50")).toEqual([
      { tipo: "PERCEPCION_SIN_CLASIFICAR", importe: "12.50" },
    ]);
    expect(tributosDeLaPantalla(null)).toEqual([]);
    expect(tributosDeLaPantalla("0")).toEqual([]);
    expect(tributosDeLaPantalla("0.00")).toEqual([]);
  });
  it("un texto que no es decimal pasa tal cual (lo rechaza el cálculo del comprobante)", () => {
    expect(tributosDeLaPantalla("abc")).toEqual([
      { tipo: "PERCEPCION_SIN_CLASIFICAR", importe: "abc" },
    ]);
  });
});

describe("repartirConciliacionDeAtajo", () => {
  const recibidas = new Map([
    [1, "2000.0000"],
    [2, "10.0000"],
  ]);
  it("asigna lo facturado cuando entró todo", () => {
    expect(
      repartirConciliacionDeAtajo([{ renglon: 1, cantidadFacturada: "2000" }], recibidas),
    ).toEqual({
      ok: true,
      valor: [{ lineaDeFactura: 1, renglon: 1, cantidad: "2000.0000" }],
    });
  });
  it("si la factura dice más de lo recibido, asigna lo recibido; si dice menos, lo facturado", () => {
    expect(
      repartirConciliacionDeAtajo([{ renglon: 2, cantidadFacturada: "15" }], recibidas),
    ).toEqual({
      ok: true,
      valor: [{ lineaDeFactura: 1, renglon: 2, cantidad: "10.0000" }],
    });
    expect(
      repartirConciliacionDeAtajo([{ renglon: 2, cantidadFacturada: "4.5" }], recibidas),
    ).toEqual({
      ok: true,
      valor: [{ lineaDeFactura: 1, renglon: 2, cantidad: "4.5000" }],
    });
  });
  it("varias líneas del mismo renglón comparten su saldo en orden; lo que no entra no genera asignación", () => {
    expect(
      repartirConciliacionDeAtajo(
        [
          { renglon: 2, cantidadFacturada: "6" },
          { renglon: 1, cantidadFacturada: "1" },
          { renglon: 2, cantidadFacturada: "6" },
          { renglon: 2, cantidadFacturada: "1" },
        ],
        recibidas,
      ),
    ).toEqual({
      ok: true,
      valor: [
        { lineaDeFactura: 1, renglon: 2, cantidad: "6.0000" },
        { lineaDeFactura: 2, renglon: 1, cantidad: "1.0000" },
        { lineaDeFactura: 3, renglon: 2, cantidad: "4.0000" },
      ],
    });
  });
  it("un renglón que no existe, o una cantidad inválida, se rechaza", () => {
    expect(
      repartirConciliacionDeAtajo([{ renglon: 3, cantidadFacturada: "1" }], recibidas),
    ).toEqual({ ok: false, error: "RENGLONES_INVALIDOS" });
    for (const cantidadFacturada of ["0", "-1", "x", ""]) {
      expect(repartirConciliacionDeAtajo([{ renglon: 1, cantidadFacturada }], recibidas)).toEqual({
        ok: false,
        error: "CANTIDAD_INVALIDA",
      });
    }
    expect(
      repartirConciliacionDeAtajo([{ renglon: 1, cantidadFacturada: "1" }], new Map([[1, "0"]])),
    ).toEqual({ ok: false, error: "CANTIDAD_INVALIDA" });
  });
  it("sin líneas no hay asignaciones", () => {
    expect(repartirConciliacionDeAtajo([], recibidas)).toEqual({ ok: true, valor: [] });
  });
});

describe("razonSocialDeLaParte", () => {
  it("une nombre y apellido, o usa el que hay", () => {
    expect(razonSocialDeLaParte("Ana", "López")).toBe("Ana López");
    expect(razonSocialDeLaParte("Distribuidora Sur", null)).toBe("Distribuidora Sur");
    expect(razonSocialDeLaParte(null, "López")).toBe("López");
    expect(razonSocialDeLaParte("", "López")).toBe("López");
  });
  it("sin nada, un texto válido; y se corta a 200 caracteres sin partir ninguno", () => {
    expect(razonSocialDeLaParte(null, null)).toBe("Sin nombre");
    expect(razonSocialDeLaParte("", "")).toBe("Sin nombre");
    expect(Array.from(razonSocialDeLaParte("a".repeat(150), "b".repeat(100)))).toHaveLength(200);
    expect(razonSocialDeLaParte("a".repeat(200), null)).toBe("a".repeat(200));
    expect(Array.from(razonSocialDeLaParte("😀".repeat(201), null))).toHaveLength(200);
  });
});
