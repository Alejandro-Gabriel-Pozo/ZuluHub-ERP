import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decidirAsignacion, saldoDeLinea } from "./saldos";

const e = (recibida: string, facturada: string | null, asignada: string, cantidad: string) => ({
  recibida,
  facturada,
  asignada,
  cantidad,
});

describe("saldoDeLinea", () => {
  it("recibida menos asignada", () => {
    expect(saldoDeLinea("10", "3.5")).toBe("6.5000");
    expect(saldoDeLinea("10", "10")).toBe("0.0000");
  });
  it("datos inválidos o asignada mayor que recibida: null", () => {
    expect(saldoDeLinea("x", "1")).toBeNull();
    expect(saldoDeLinea("x", "0")).toBeNull();
    expect(saldoDeLinea("1", "x")).toBeNull();
    expect(saldoDeLinea("1", "1.0001")).toBeNull();
  });
});

describe("decidirAsignacion: lo asignado nunca supera lo recibido ni lo facturado", () => {
  it("entra en el borde", () => {
    expect(decidirAsignacion(e("10", "10", "4", "6"))).toEqual({ ok: true, valor: "10.0000" });
    expect(decidirAsignacion(e("10", null, "0", "10"))).toEqual({ ok: true, valor: "10.0000" });
    expect(decidirAsignacion(e("10", "8", "0", "0.0001"))).toEqual({ ok: true, valor: "0.0001" });
  });
  it("excede lo recibido (se informa antes que lo facturado)", () => {
    expect(decidirAsignacion(e("10", "20", "4", "6.0001"))).toEqual({
      ok: false,
      error: "CANTIDAD_ASIGNADA_EXCEDE_LO_RECIBIDO",
    });
    expect(decidirAsignacion(e("5", "5", "0", "6"))).toEqual({
      ok: false,
      error: "CANTIDAD_ASIGNADA_EXCEDE_LO_RECIBIDO",
    });
  });
  it("excede lo facturado", () => {
    expect(decidirAsignacion(e("10", "5", "4", "1.0001"))).toEqual({
      ok: false,
      error: "CANTIDAD_ASIGNADA_EXCEDE_LO_FACTURADO",
    });
  });
  it("cantidades inválidas, cero o negativas", () => {
    for (const cantidad of ["0", "x", "-1", ""])
      expect(decidirAsignacion(e("10", "10", "0", cantidad)), cantidad).toEqual({
        ok: false,
        error: "CANTIDAD_INVALIDA",
      });
    expect(decidirAsignacion(e("x", "10", "0", "1"))).toEqual({
      ok: false,
      error: "CANTIDAD_INVALIDA",
    });
    expect(decidirAsignacion(e("10", "10", "x", "1"))).toEqual({
      ok: false,
      error: "CANTIDAD_INVALIDA",
    });
    expect(decidirAsignacion(e("10", "x", "0", "1"))).toEqual({
      ok: false,
      error: "CANTIDAD_INVALIDA",
    });
  });
  it("propiedad: si entra, la asignada nueva no supera ninguna de las dos; si no, alguna se superaría", () => {
    const n = fc.integer({ min: 0, max: 1000 });
    fc.assert(
      fc.property(n, n, n, n, (recibida, facturada, asignada, cantidad) => {
        const r = decidirAsignacion(e(`${recibida}`, `${facturada}`, `${asignada}`, `${cantidad}`));
        const nueva = asignada + cantidad;
        if (cantidad === 0) expect(r).toEqual({ ok: false, error: "CANTIDAD_INVALIDA" });
        else if (r.ok) {
          expect(nueva).toBeLessThanOrEqual(recibida);
          expect(nueva).toBeLessThanOrEqual(facturada);
          expect(r.valor).toBe(`${nueva}.0000`);
        } else expect(nueva > recibida || nueva > facturada).toBe(true);
      }),
    );
  });
});
