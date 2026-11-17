import { describe, expect, it } from "vitest";
import { huellaDeEnvio, huellaDeImpresion } from "./huella";
import {
  decidirReintento,
  estadoDelTrabajo,
  papelEnMm,
  tipoDeDocumento,
  usoDeImpresora,
  usoParaElDocumento,
} from "./impresion";

describe("estadoDelTrabajo", () => {
  it("sin intentos está pendiente; con intentos, manda el último por número", () => {
    expect(estadoDelTrabajo([])).toBe("PENDIENTE");
    expect(estadoDelTrabajo([{ numero: 1, resultado: "FALLIDA" }])).toBe("FALLIDA");
    expect(
      estadoDelTrabajo([
        { numero: 2, resultado: "IMPRESA" },
        { numero: 1, resultado: "FALLIDA" },
      ]),
    ).toBe("IMPRESA");
  });
});

describe("reintento y listas cerradas", () => {
  it("solo se reintenta lo fallido", () => {
    expect(decidirReintento("FALLIDA").ok).toBe(true);
    expect(decidirReintento("PENDIENTE")).toEqual({ ok: false, error: "TRABAJO_NO_REINTENTABLE" });
    expect(decidirReintento("IMPRESA")).toEqual({ ok: false, error: "TRABAJO_NO_REINTENTABLE" });
  });
  it("papel 58 u 80, uso y documento de lista cerrada", () => {
    expect(papelEnMm(58)).toEqual({ ok: true, valor: 58 });
    expect(papelEnMm(80)).toEqual({ ok: true, valor: 80 });
    expect(papelEnMm(70)).toEqual({ ok: false, error: "PAPEL_INVALIDO" });
    expect(usoDeImpresora("TICKET").ok).toBe(true);
    expect(usoDeImpresora("otro")).toEqual({ ok: false, error: "USO_INVALIDO" });
    expect(tipoDeDocumento("ANULACION").ok).toBe(true);
    expect(tipoDeDocumento("X")).toEqual({ ok: false, error: "DOCUMENTO_INVALIDO" });
  });
  it("la comanda y el aviso van a la impresora de cocina; el ticket, a la del cliente", () => {
    expect(usoParaElDocumento("COMANDA")).toBe("COMANDA");
    expect(usoParaElDocumento("ANULACION")).toBe("COMANDA");
    expect(usoParaElDocumento("TICKET")).toBe("TICKET");
  });
});

describe("huellas", () => {
  it("el envío no depende del orden de las líneas y cambia con la intención", () => {
    const h = huellaDeEnvio({ cuentaId: "c", tipo: "SALIDA_PEDIDA", lineaIds: ["a", "b"] });
    expect(huellaDeEnvio({ cuentaId: "c", tipo: "SALIDA_PEDIDA", lineaIds: ["b", "a"] })).toBe(h);
    expect(huellaDeEnvio({ cuentaId: "c", tipo: "SALIDA_PEDIDA", lineaIds: "TODAS" })).not.toBe(h);
    expect(huellaDeEnvio({ cuentaId: "c", tipo: "ENVIO", lineaIds: ["a", "b"] })).not.toBe(h);
    expect(huellaDeEnvio({ cuentaId: "d", tipo: "SALIDA_PEDIDA", lineaIds: ["a", "b"] })).not.toBe(
      h,
    );
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it("la impresión distingue original de copia, documento e impresora", () => {
    const base = {
      documentoTipo: "COMANDA",
      documentoId: "d",
      impresoraId: "i",
      esCopia: false,
    } as const;
    const h = huellaDeImpresion(base);
    expect(huellaDeImpresion({ ...base })).toBe(h);
    expect(huellaDeImpresion({ ...base, esCopia: true })).not.toBe(h);
    expect(huellaDeImpresion({ ...base, impresoraId: null })).not.toBe(h);
    expect(huellaDeImpresion({ ...base, documentoTipo: "TICKET" })).not.toBe(h);
    expect(huellaDeImpresion({ ...base, documentoId: "e" })).not.toBe(h);
  });
});
