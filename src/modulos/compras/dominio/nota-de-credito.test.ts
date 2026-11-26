import { describe, expect, it } from "vitest";
import {
  huellaDeLaNota,
  huellaDeLaNotaDeCredito,
  leerNota,
  leerNotaDeCredito,
  leerNotaDeDebito,
  MAXIMO_DE_IMPORTES_DE_UNA_NOTA,
} from "./nota-de-credito";

const PROVEEDOR = "00000000-0000-4000-8000-0000000000a1";
const FACTURA = "00000000-0000-4000-8000-0000000000f1";

const nota = (extra: Record<string, unknown> = {}) => ({
  tipo: "NOTA_CREDITO_A",
  puntoDeVenta: 5,
  numero: 123,
  fecha: "2026-11-10",
  importes: [{ alicuota: "21", neto: "100.50" }],
  totalSegunNota: "121.61",
  ...extra,
});

describe("leerNotaDeCredito", () => {
  it("lee la nota completa; en una B o C la alícuota es opcional (null)", () => {
    expect(leerNotaDeCredito(nota())).toEqual({
      ok: true,
      valor: {
        tipo: "NOTA_CREDITO_A",
        puntoDeVenta: 5,
        numero: 123,
        fecha: "2026-11-10",
        importes: [{ alicuota: "21", neto: "100.50" }],
        totalSegunNota: "121.61",
      },
    });
    expect(
      leerNotaDeCredito(
        nota({ tipo: "NOTA_CREDITO_B", importes: [{ neto: "10" }], moneda: "ARS" }),
      ),
    ).toMatchObject({ ok: true, valor: { importes: [{ alicuota: null, neto: "10" }] } });
  });

  it("solo una nota de crédito: factura y nota de débito no pasan, ni lo que no es un tipo", () => {
    for (const tipo of ["FACTURA_A", "NOTA_DEBITO_A", "NOTA_DEBITO_C", "x", 3, null, undefined]) {
      expect(leerNotaDeCredito(nota({ tipo })), String(tipo)).toEqual({
        ok: false,
        error: "TIPO_DE_COMPROBANTE_INVALIDO",
      });
    }
    for (const tipo of ["NOTA_CREDITO_A", "NOTA_CREDITO_B", "NOTA_CREDITO_C"]) {
      expect(leerNotaDeCredito(nota({ tipo }))).toMatchObject({ ok: true });
    }
    expect(leerNotaDeCredito(null)).toEqual({ ok: false, error: "TIPO_DE_COMPROBANTE_INVALIDO" });
    expect(leerNotaDeCredito([])).toEqual({ ok: false, error: "TIPO_DE_COMPROBANTE_INVALIDO" });
  });

  it("punto de venta y número en los rangos de ARCA", () => {
    for (const puntoDeVenta of [0, 99999, 1.5, "5", null, undefined]) {
      expect(leerNotaDeCredito(nota({ puntoDeVenta })), String(puntoDeVenta)).toEqual({
        ok: false,
        error: "PUNTO_DE_VENTA_INVALIDO",
      });
    }
    for (const numero of [0, 100000000, 1.5, "1", null, undefined]) {
      expect(leerNotaDeCredito(nota({ numero })), String(numero)).toEqual({
        ok: false,
        error: "NUMERO_DE_COMPROBANTE_INVALIDO",
      });
    }
    expect(leerNotaDeCredito(nota({ puntoDeVenta: 99998, numero: 99999999 }))).toMatchObject({
      ok: true,
    });
    expect(leerNotaDeCredito(nota({ puntoDeVenta: 1, numero: 1 }))).toMatchObject({ ok: true });
  });

  it("fecha civil y moneda en pesos", () => {
    for (const fecha of ["2026-02-30", "mañana", 20261110, null, undefined, ["2026-11-10"]]) {
      expect(leerNotaDeCredito(nota({ fecha })), String(fecha)).toEqual({
        ok: false,
        error: "FECHA_INVALIDA",
      });
    }
    expect(leerNotaDeCredito(nota({ moneda: "USD" }))).toEqual({
      ok: false,
      error: "MONEDA_NO_SOPORTADA",
    });
    expect(leerNotaDeCredito(nota({ moneda: null }))).toEqual({
      ok: false,
      error: "MONEDA_NO_SOPORTADA",
    });
  });

  it("los importes: no vacíos, con tope y cada uno con neto de texto y alícuota de texto o null", () => {
    const con = (importes: unknown) => leerNotaDeCredito(nota({ importes }));
    expect(con([])).toEqual({ ok: false, error: "LINEAS_REQUERIDAS" });
    expect(con("x")).toEqual({ ok: false, error: "LINEAS_REQUERIDAS" });
    expect(con(undefined)).toEqual({ ok: false, error: "LINEAS_REQUERIDAS" });
    const muchos = (n: number) => Array.from({ length: n }, () => ({ alicuota: "21", neto: "1" }));
    expect(MAXIMO_DE_IMPORTES_DE_UNA_NOTA).toBe(99);
    expect(con(muchos(99))).toMatchObject({ ok: true });
    expect(con(muchos(100))).toEqual({ ok: false, error: "RENGLONES_INVALIDOS" });
    for (const malo of [
      5,
      null,
      "x",
      { alicuota: "21" },
      { alicuota: "21", neto: 5 },
      { alicuota: 21, neto: "1" },
    ]) {
      expect(con([malo]), JSON.stringify(malo)).toEqual({
        ok: false,
        error: "RENGLONES_INVALIDOS",
      });
    }
  });

  it("el total que dice el papel es un texto", () => {
    for (const totalSegunNota of [121.61, null, undefined]) {
      expect(leerNotaDeCredito(nota({ totalSegunNota })), String(totalSegunNota)).toEqual({
        ok: false,
        error: "TOTAL_INVALIDO",
      });
    }
  });
});

describe("huellaDeLaNotaDeCredito", () => {
  const leida = (extra: Record<string, unknown> = {}) => {
    const r = leerNotaDeCredito(nota(extra));
    if (!r.ok) throw new Error("nota de prueba inválida");
    return r.valor;
  };
  const base = huellaDeLaNotaDeCredito(PROVEEDOR, FACTURA, leida());

  it("la huella no cambia entre versiones: es la que ya guardaron las notas (la repetición de una clave depende de ella)", () => {
    expect(base).toBe("0df4b768a92ea3c5d68bfd583a3d75e43d1fac67ecb35a92cb45a457de83ae01");
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  it("los mismos importes en otro orden son el mismo pedido y cualquier campo distinto da otra huella", () => {
    const a = { alicuota: "21", neto: "10" };
    const b = { alicuota: "10.5", neto: "20" };
    expect(huellaDeLaNotaDeCredito(PROVEEDOR, FACTURA, leida({ importes: [a, b] }))).toBe(
      huellaDeLaNotaDeCredito(PROVEEDOR, FACTURA, leida({ importes: [b, a] })),
    );
    const otras = [
      huellaDeLaNotaDeCredito(FACTURA, FACTURA, leida()),
      huellaDeLaNotaDeCredito(PROVEEDOR, PROVEEDOR, leida()),
      huellaDeLaNotaDeCredito(PROVEEDOR, FACTURA, leida({ tipo: "NOTA_CREDITO_B" })),
      huellaDeLaNotaDeCredito(PROVEEDOR, FACTURA, leida({ puntoDeVenta: 6 })),
      huellaDeLaNotaDeCredito(PROVEEDOR, FACTURA, leida({ numero: 124 })),
      huellaDeLaNotaDeCredito(PROVEEDOR, FACTURA, leida({ fecha: "2026-11-11" })),
      huellaDeLaNotaDeCredito(PROVEEDOR, FACTURA, leida({ totalSegunNota: "121.62" })),
      huellaDeLaNotaDeCredito(
        PROVEEDOR,
        FACTURA,
        leida({ importes: [{ alicuota: "10.5", neto: "100.50" }] }),
      ),
      huellaDeLaNotaDeCredito(
        PROVEEDOR,
        FACTURA,
        leida({ importes: [{ alicuota: "21", neto: "100.51" }] }),
      ),
    ];
    expect(new Set([base, ...otras]).size).toBe(otras.length + 1);
  });
});

describe("la nota de débito", () => {
  it("lee los tipos de débito y no los de crédito (cada clase lee solo los suyos)", () => {
    expect(leerNotaDeDebito(nota({ tipo: "NOTA_DEBITO_A" }))).toMatchObject({
      ok: true,
      valor: { tipo: "NOTA_DEBITO_A" },
    });
    for (const tipo of ["NOTA_CREDITO_A", "FACTURA_A", "NOTA_DEBITO_Z", null, 7]) {
      expect(leerNotaDeDebito(nota({ tipo })), String(tipo)).toEqual({
        ok: false,
        error: "TIPO_DE_COMPROBANTE_INVALIDO",
      });
    }
    expect(leerNotaDeCredito(nota({ tipo: "NOTA_DEBITO_A" }))).toEqual({
      ok: false,
      error: "TIPO_DE_COMPROBANTE_INVALIDO",
    });
    expect(leerNota(nota({ tipo: "NOTA_DEBITO_B" }), "NOTA_DE_DEBITO")).toMatchObject({ ok: true });
  });

  it("la huella distingue la clase y el vínculo: una nota de débito suelta (sin factura) no es la vinculada ni la de crédito", () => {
    const d = leerNotaDeDebito(nota({ tipo: "NOTA_DEBITO_A" }));
    if (!d.ok) throw new Error("nota de prueba inválida");
    const vinculada = huellaDeLaNota("NOTA_DE_DEBITO", PROVEEDOR, FACTURA, d.valor);
    const suelta = huellaDeLaNota("NOTA_DE_DEBITO", PROVEEDOR, null, d.valor);
    const comoCredito = huellaDeLaNota("NOTA_DE_CREDITO", PROVEEDOR, FACTURA, d.valor);
    expect(new Set([vinculada, suelta, comoCredito]).size).toBe(3);
    expect(huellaDeLaNota("NOTA_DE_DEBITO", PROVEEDOR, null, d.valor)).toBe(suelta);
  });
});
