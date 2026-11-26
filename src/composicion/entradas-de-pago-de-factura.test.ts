import { describe, expect, it } from "vitest";
import { MEDIOS_DE_PAGO } from "../modulos/compras/publico";
import { entradaDeAnularPago, entradaDeDeclararPago } from "./entradas-de-pago-de-factura";

const ID = "0b0b0b0b-1111-4222-8333-444444444444";
const OTRO = "0c0c0c0c-1111-4222-8333-444444444444";
const base = { clave: ID, comprobanteId: OTRO, fechaDePago: "2026-11-24", medio: "TRANSFERENCIA" };

describe("la frontera de «Declarar pago»", () => {
  it("toma solo los campos declarados; sin caja ni motivo no hay salida de caja, y el importe no existe", () => {
    expect(entradaDeDeclararPago(base)).toEqual({ ok: true, valor: base });
  });

  it("con efectivo lleva la caja y el motivo como salida de caja", () => {
    expect(
      entradaDeDeclararPago({
        ...base,
        medio: "EFECTIVO",
        cajaId: ID,
        motivo: "Pago de la factura",
      }),
    ).toEqual({
      ok: true,
      valor: {
        ...base,
        medio: "EFECTIVO",
        salidaDeCaja: { cajaId: ID, motivo: "Pago de la factura" },
      },
    });
  });

  it("una caja sin motivo (o un motivo sin caja) llega como salida mal formada: el servidor la rechaza; nunca se completa sola", () => {
    expect(entradaDeDeclararPago({ ...base, medio: "EFECTIVO", cajaId: ID })).toEqual({
      ok: true,
      valor: { ...base, medio: "EFECTIVO", salidaDeCaja: { cajaId: ID, motivo: "" } },
    });
    expect(entradaDeDeclararPago({ ...base, medio: "EFECTIVO", motivo: "Pago" })).toEqual({
      ok: true,
      valor: { ...base, medio: "EFECTIVO", salidaDeCaja: { cajaId: "", motivo: "Pago" } },
    });
  });

  it("cada medio de la lista del dominio pasa y uno fuera de ella no", () => {
    for (const medio of MEDIOS_DE_PAGO) {
      expect(entradaDeDeclararPago({ ...base, medio }).ok).toBe(true);
    }
    for (const medio of ["CHEQUE", "efectivo", "", null, 1, undefined]) {
      expect(entradaDeDeclararPago({ ...base, medio }).ok).toBe(false);
    }
  });

  it("varios medios llevan cada uno su importe; `COMPUESTO`, un importe que no es texto, una lista vacía o de más de seis y los campos de más no pasan", () => {
    const sinMedio = { clave: ID, comprobanteId: OTRO, fechaDePago: base.fechaDePago };
    const medios = [
      { medio: "EFECTIVO", importe: "1000.00" },
      { medio: "QR", importe: "1420.00" },
    ];
    expect(entradaDeDeclararPago({ ...sinMedio, medios })).toEqual({
      ok: true,
      valor: { ...sinMedio, medios },
    });
    for (const malos of [
      [{ medio: "COMPUESTO", importe: "1.00" }],
      [{ medio: "QR", importe: 5 }],
      [{ medio: "QR", importe: "1.00", moneda: "USD" }],
      [{ medio: "QR" }],
      [],
      [...MEDIOS_DE_PAGO, "QR"].map((medio) => ({ medio, importe: "1.00" })),
    ]) {
      expect(entradaDeDeclararPago({ ...sinMedio, medios: malos }).ok).toBe(false);
    }
    expect(entradaDeDeclararPago({ ...sinMedio, medio: "COMPUESTO" }).ok).toBe(false);
  });

  it("un campo de más (importe, empresa, sucursal, persona) hace inválido el pedido: lo que no se declaró no pasa", () => {
    for (const extra of [
      { importe: "1.00" },
      { empresaId: ID },
      { sucursalId: ID },
      { personaId: ID },
      { moneda: "USD" },
    ]) {
      expect(entradaDeDeclararPago({ ...base, ...extra }).ok).toBe(false);
    }
  });

  it("la clave y la factura tienen que ser identificadores; la fecha, un texto acotado", () => {
    expect(entradaDeDeclararPago({ ...base, clave: "x" }).ok).toBe(false);
    expect(entradaDeDeclararPago({ ...base, comprobanteId: "../x" }).ok).toBe(false);
    expect(entradaDeDeclararPago({ ...base, fechaDePago: "x".repeat(1001) }).ok).toBe(false);
    expect(entradaDeDeclararPago({ ...base, fechaDePago: 20261124 }).ok).toBe(false);
    expect(entradaDeDeclararPago(null).ok).toBe(false);
    expect(entradaDeDeclararPago("texto").ok).toBe(false);
  });
});

describe("la frontera de anular un pago", () => {
  it("toma el pago y el motivo y nada más", () => {
    expect(entradaDeAnularPago({ pagoId: ID, motivo: "Se pagó mal" })).toEqual({
      ok: true,
      valor: { pagoId: ID, motivo: "Se pagó mal" },
    });
    expect(entradaDeAnularPago({ pagoId: ID, motivo: "x", empresaId: OTRO }).ok).toBe(false);
    expect(entradaDeAnularPago({ pagoId: "no", motivo: "x" }).ok).toBe(false);
    expect(entradaDeAnularPago({ pagoId: ID }).ok).toBe(false);
  });
});
