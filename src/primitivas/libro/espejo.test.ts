import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { esAnulable, espejoDe, type AsientoParaEspejo } from "./espejo";

const original: AsientoParaEspejo<bigint> = {
  id: "asiento-1",
  parteId: "parte-1",
  sentido: "A_COBRAR",
  clase: "FACTURA",
  magnitud: 1500n,
  anulaA: null,
};
const negar = (m: bigint): bigint => -m;

describe("esAnulable", () => {
  it("un asiento común se puede anular", () => {
    expect(esAnulable(original)).toBe(true);
  });

  it("una anulación no se puede anular", () => {
    expect(esAnulable({ ...original, anulaA: "asiento-0" })).toBe(false);
  });
});

describe("espejoDe", () => {
  it("invierte exactamente la magnitud y conserva parte, sentido y clase; apunta al original", () => {
    expect(espejoDe(original, "Error de carga", negar)).toEqual({
      ok: true,
      valor: {
        parteId: "parte-1",
        sentido: "A_COBRAR",
        clase: "FACTURA",
        magnitud: -1500n,
        anulaA: "asiento-1",
      },
    });
  });

  it("no anula una anulación", () => {
    expect(espejoDe({ ...original, anulaA: "x" }, "motivo", negar)).toEqual({
      ok: false,
      error: "YA_ES_UNA_ANULACION",
    });
  });

  it.each(["", "   ", "\t\n "])("el detalle %j es DETALLE_OBLIGATORIO", (detalle) => {
    expect(espejoDe(original, detalle, negar)).toEqual({ ok: false, error: "DETALLE_OBLIGATORIO" });
  });

  it("si es anulación Y falta detalle, gana YA_ES_UNA_ANULACION", () => {
    expect(espejoDe({ ...original, anulaA: "x" }, "", negar)).toEqual({
      ok: false,
      error: "YA_ES_UNA_ANULACION",
    });
  });

  it("espejo del espejo de la magnitud devuelve la original (propiedad)", () => {
    fc.assert(
      fc.property(fc.bigInt(), (m) => {
        const r = espejoDe({ ...original, magnitud: m }, "motivo", negar);
        return r.ok && negar(r.valor.magnitud) === m;
      }),
    );
  });

  it("es idempotente: el mismo pedido da el mismo espejo", () => {
    expect(espejoDe(original, "motivo", negar)).toEqual(espejoDe(original, "motivo", negar));
  });
});
