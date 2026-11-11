import { describe, expect, it } from "vitest";
import { decidirUnion, huellaDeUnion, type CuentaParaUnir } from "./union";

const c = (cuentaId: string, extra: Partial<CuentaParaUnir> = {}): CuentaParaUnir => ({
  cuentaId,
  sucursalId: "s1",
  conCobro: false,
  dividida: false,
  unida: false,
  ...extra,
});

describe("decidirUnion", () => {
  it("dos cuentas abiertas de la misma sucursal se pueden unir", () => {
    expect(decidirUnion(c("a"), c("b"))).toEqual({ ok: true, valor: null });
  });
  it("cada caso dice su motivo, en un orden fijo", () => {
    expect(decidirUnion(null, c("b"))).toEqual({ ok: false, error: "MESA_LIBRE" });
    expect(decidirUnion(c("a"), null)).toEqual({ ok: false, error: "MESA_LIBRE" });
    expect(decidirUnion(c("a"), c("a"))).toEqual({ ok: false, error: "MISMA_CUENTA" });
    expect(decidirUnion(c("a"), c("b", { sucursalId: "s2" }))).toEqual({
      ok: false,
      error: "SUCURSAL_DISTINTA",
    });
    expect(decidirUnion(c("a", { unida: true }), c("b"))).toEqual({
      ok: false,
      error: "MESA_UNIDA",
    });
    expect(decidirUnion(c("a"), c("b", { unida: true, dividida: true }))).toEqual({
      ok: false,
      error: "MESA_UNIDA",
    });
    expect(decidirUnion(c("a"), c("b", { dividida: true }))).toEqual({
      ok: false,
      error: "MESA_DIVIDIDA",
    });
    expect(decidirUnion(c("a", { conCobro: true }), c("b"))).toEqual({
      ok: false,
      error: "MESA_CON_COBRO",
    });
    expect(decidirUnion(c("a", { dividida: true, conCobro: true }), c("b"))).toEqual({
      ok: false,
      error: "MESA_DIVIDIDA",
    });
  });
});

describe("huellaDeUnion", () => {
  it("unir A con B y B con A son pedidos distintos", () => {
    const ab = huellaDeUnion({ cuentaDestinoId: "a", cuentaOrigenId: "b" });
    expect(huellaDeUnion({ cuentaDestinoId: "a", cuentaOrigenId: "b" })).toBe(ab);
    expect(huellaDeUnion({ cuentaDestinoId: "b", cuentaOrigenId: "a" })).not.toBe(ab);
  });
});
