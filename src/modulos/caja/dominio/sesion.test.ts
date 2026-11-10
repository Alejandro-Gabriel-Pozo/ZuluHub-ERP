import { describe, expect, it } from "vitest";
import { ESTADOS_DE_SESION } from "../estados";
import {
  TRANSICIONES_DE_SESION,
  decidirCancelarCierre,
  decidirIniciarCierre,
  estadoDeCaja,
  exigirCajaAbiertaParaCobrar,
  exigirSesionAbierta,
  transicionDeSesionPermitida,
} from "./sesion";

describe("estados y transiciones de la sesión de caja", () => {
  it("permite exactamente ABIERTA→EN_CIERRE, ABIERTA→CERRADA, EN_CIERRE→ABIERTA y EN_CIERRE→CERRADA", () => {
    const permitidas = ESTADOS_DE_SESION.flatMap((desde) =>
      ESTADOS_DE_SESION.filter((hacia) => transicionDeSesionPermitida(desde, hacia)).map(
        (hacia) => `${desde}>${hacia}`,
      ),
    );
    expect(permitidas.sort()).toEqual(
      ["ABIERTA>CERRADA", "ABIERTA>EN_CIERRE", "EN_CIERRE>ABIERTA", "EN_CIERRE>CERRADA"].sort(),
    );
  });

  it("nada sale de CERRADA: no se reabre", () => {
    expect(TRANSICIONES_DE_SESION.CERRADA).toEqual([]);
  });

  it("iniciar el cierre: empieza desde ABIERTA, repetirlo no hace nada y una cerrada no se toca", () => {
    expect(decidirIniciarCierre("ABIERTA")).toEqual({ ok: true, valor: "INICIAR" });
    expect(decidirIniciarCierre("EN_CIERRE")).toEqual({ ok: true, valor: "YA_ESTABA" });
    expect(decidirIniciarCierre("CERRADA")).toEqual({ ok: false, error: "SESION_CERRADA" });
  });

  it("cancelar el cierre: vuelve desde EN_CIERRE, repetirlo no hace nada y una cerrada no se toca", () => {
    expect(decidirCancelarCierre("EN_CIERRE")).toEqual({ ok: true, valor: "CANCELAR" });
    expect(decidirCancelarCierre("ABIERTA")).toEqual({ ok: true, valor: "YA_ESTABA" });
    expect(decidirCancelarCierre("CERRADA")).toEqual({ ok: false, error: "SESION_CERRADA" });
  });

  it("solo una sesión ABIERTA admite movimientos", () => {
    expect(exigirSesionAbierta("ABIERTA")).toEqual({ ok: true, valor: null });
    expect(exigirSesionAbierta("EN_CIERRE")).toEqual({ ok: false, error: "SESION_EN_CIERRE" });
    expect(exigirSesionAbierta("CERRADA")).toEqual({ ok: false, error: "SESION_CERRADA" });
  });

  it("el estado de una caja sale de su sesión vigente: sin sesión o con una cerrada no hay sesión", () => {
    expect(estadoDeCaja(null)).toBe("SIN_SESION");
    expect(estadoDeCaja("CERRADA")).toBe("SIN_SESION");
    expect(estadoDeCaja("ABIERTA")).toBe("ABIERTA");
    expect(estadoDeCaja("EN_CIERRE")).toBe("EN_CIERRE");
  });

  it("cobrar: solo con la caja abierta; en cierre y sin sesión son errores distintos (decisión 145)", () => {
    expect(exigirCajaAbiertaParaCobrar("ABIERTA")).toEqual({ ok: true, valor: null });
    expect(exigirCajaAbiertaParaCobrar("EN_CIERRE")).toEqual({
      ok: false,
      error: "CAJA_EN_CIERRE",
    });
    expect(exigirCajaAbiertaParaCobrar(null)).toEqual({ ok: false, error: "SIN_SESION_ABIERTA" });
    expect(exigirCajaAbiertaParaCobrar("CERRADA")).toEqual({
      ok: false,
      error: "SIN_SESION_ABIERTA",
    });
  });
});
