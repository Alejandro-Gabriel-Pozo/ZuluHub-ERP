import { describe, expect, it } from "vitest";
import {
  camposDeHuellaDePago,
  esClasePagable,
  esMedioDePago,
  leerPago,
  MEDIOS_DE_PAGO,
} from "./pago";

const AHORA = new Date("2026-10-11T12:00:00Z");

describe("leerPago", () => {
  it("lee una fecha pasada o de hoy y un medio de la lista", () => {
    expect(leerPago({ fechaDePago: "2026-10-11", medio: "EFECTIVO" }, AHORA)).toEqual({
      ok: true,
      valor: { fechaDePago: "2026-10-11", medio: "EFECTIVO" },
    });
    expect(leerPago({ fechaDePago: "2026-01-01", medio: "QR" }, AHORA).ok).toBe(true);
  });
  it("rechaza una fecha futura, imposible, de otro tipo o ausente", () => {
    const engano = { toString: () => "2026-10-10" };
    for (const fechaDePago of [
      "2026-10-12",
      "2026-02-30",
      "ayer",
      "",
      null,
      undefined,
      20261010,
      engano,
    ]) {
      expect(leerPago({ fechaDePago, medio: "EFECTIVO" }, AHORA)).toEqual({
        ok: false,
        error: "FECHA_INVALIDA",
      });
    }
  });
  it("el «hoy» es el de Argentina: a las 01:00 UTC del 12 todavía es 11", () => {
    const tarde = new Date("2026-10-12T01:00:00Z");
    expect(leerPago({ fechaDePago: "2026-10-11", medio: "OTRO" }, tarde).ok).toBe(true);
    expect(leerPago({ fechaDePago: "2026-10-12", medio: "OTRO" }, tarde)).toEqual({
      ok: false,
      error: "FECHA_INVALIDA",
    });
  });
  it("rechaza un medio que no es de la lista", () => {
    for (const medio of ["CHEQUE", "efectivo", "", null, undefined, 3, { toString: () => "QR" }]) {
      expect(leerPago({ fechaDePago: "2026-10-11", medio }, AHORA)).toEqual({
        ok: false,
        error: "MEDIO_INVALIDO",
      });
    }
  });
  it("la fecha se mira antes que el medio; lo que no es un objeto no tiene fecha", () => {
    expect(leerPago({ fechaDePago: "x", medio: "x" }, AHORA)).toEqual({
      ok: false,
      error: "FECHA_INVALIDA",
    });
    for (const v of [null, undefined, 3, "x", []]) {
      expect(leerPago(v, AHORA)).toEqual({ ok: false, error: "FECHA_INVALIDA" });
    }
  });
});

describe("medios, clases y huella", () => {
  it("los seis medios de caja", () => {
    expect([...MEDIOS_DE_PAGO]).toEqual([
      "EFECTIVO",
      "TARJETA_DEBITO",
      "TARJETA_CREDITO",
      "TRANSFERENCIA",
      "QR",
      "OTRO",
    ]);
    for (const m of MEDIOS_DE_PAGO) expect(esMedioDePago(m)).toBe(true);
    expect(esMedioDePago("CHEQUE")).toBe(false);
  });
  it("se paga una factura o una nota de débito; una nota de crédito o cualquier otra cosa, no", () => {
    expect(esClasePagable("FACTURA")).toBe(true);
    expect(esClasePagable("NOTA_DE_DEBITO")).toBe(true);
    for (const c of ["NOTA_DE_CREDITO", "SIN_COMPROBANTE", "", "factura"])
      expect(esClasePagable(c)).toBe(false);
  });
  it("los campos de la huella son fecha, medio e importe, en ese orden", () => {
    expect(camposDeHuellaDePago({ fechaDePago: "2026-10-11", medio: "QR" }, "2420.00")).toEqual([
      "2026-10-11",
      "QR",
      "2420.00",
    ]);
  });
});
