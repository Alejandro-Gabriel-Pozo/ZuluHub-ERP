import { describe, expect, it } from "vitest";
import {
  ESTADOS_DE_ORDEN,
  esEstadoDeOrden,
  transicionar,
  yaEstaba,
  type AccionSobreOrden,
} from "./orden";

describe("máquina de estados de la orden", () => {
  it("abierta cierra o se cancela; cerrada se anula", () => {
    expect(transicionar("ABIERTA", "CERRAR")).toEqual({ ok: true, valor: "CERRADA" });
    expect(transicionar("ABIERTA", "CANCELAR")).toEqual({ ok: true, valor: "CANCELADA" });
    expect(transicionar("CERRADA", "ANULAR")).toEqual({ ok: true, valor: "ANULADA" });
  });
  it("lo demás se rechaza con su motivo", () => {
    expect(transicionar("CANCELADA", "CERRAR")).toEqual({ ok: false, error: "ORDEN_CANCELADA" });
    expect(transicionar("CANCELADA", "ANULAR")).toEqual({ ok: false, error: "ORDEN_CANCELADA" });
    expect(transicionar("ANULADA", "CERRAR")).toEqual({ ok: false, error: "ORDEN_ANULADA" });
    expect(transicionar("ANULADA", "CANCELAR")).toEqual({ ok: false, error: "ORDEN_ANULADA" });
    expect(transicionar("CERRADA", "CANCELAR")).toEqual({ ok: false, error: "ORDEN_YA_CERRADA" });
    expect(transicionar("CERRADA", "CERRAR")).toEqual({ ok: false, error: "ORDEN_YA_CERRADA" });
    expect(transicionar("ABIERTA", "ANULAR")).toEqual({ ok: false, error: "ORDEN_NO_CERRADA" });
  });
  it("yaEstaba dice cuándo la acción ya está hecha", () => {
    const casos: Array<[Parameters<typeof yaEstaba>[0], AccionSobreOrden, boolean]> = [
      ["CERRADA", "CERRAR", true],
      ["ABIERTA", "CERRAR", false],
      ["CANCELADA", "CANCELAR", true],
      ["CERRADA", "CANCELAR", false],
      ["ANULADA", "ANULAR", true],
      ["CERRADA", "ANULAR", false],
    ];
    for (const [estado, accion, esperado] of casos)
      expect(yaEstaba(estado, accion), `${estado} ${accion}`).toBe(esperado);
  });
  it("conoce los cuatro estados", () => {
    expect(ESTADOS_DE_ORDEN).toEqual(["ABIERTA", "CERRADA", "CANCELADA", "ANULADA"]);
    expect(esEstadoDeOrden("ABIERTA")).toBe(true);
    expect(esEstadoDeOrden("abierta")).toBe(false);
  });
});
