import { describe, expect, it } from "vitest";
import {
  ESTADOS_DE_JORNADA,
  TRANSICIONES_DE_JORNADA,
  decidirCancelar,
  decidirIniciar,
  transicionPermitida,
} from "./jornada";

describe("estados y transiciones de la jornada", () => {
  it("permite exactamente ABIERTA → EN_AUDITORIA, EN_AUDITORIA → ABIERTA y EN_AUDITORIA → CERRADA", () => {
    const permitidas = ESTADOS_DE_JORNADA.flatMap((desde) =>
      ESTADOS_DE_JORNADA.filter((hacia) => transicionPermitida(desde, hacia)).map(
        (hacia) => `${desde}>${hacia}`,
      ),
    );
    expect(permitidas.sort()).toEqual(
      ["ABIERTA>EN_AUDITORIA", "EN_AUDITORIA>ABIERTA", "EN_AUDITORIA>CERRADA"].sort(),
    );
  });

  it("nada sale de CERRADA", () => {
    expect(TRANSICIONES_DE_JORNADA.CERRADA).toEqual([]);
  });

  it("iniciar: empieza desde ABIERTA, repetirlo no hace nada y una cerrada no se toca", () => {
    expect(decidirIniciar("ABIERTA")).toEqual({ ok: true, valor: "INICIAR" });
    expect(decidirIniciar("EN_AUDITORIA")).toEqual({ ok: true, valor: "YA_ESTABA" });
    expect(decidirIniciar("CERRADA")).toEqual({ ok: false, error: "JORNADA_CERRADA" });
  });

  it("cancelar: vuelve desde EN_AUDITORIA, repetirlo no hace nada y una cerrada no se toca", () => {
    expect(decidirCancelar("EN_AUDITORIA")).toEqual({ ok: true, valor: "CANCELAR" });
    expect(decidirCancelar("ABIERTA")).toEqual({ ok: true, valor: "YA_ESTABA" });
    expect(decidirCancelar("CERRADA")).toEqual({ ok: false, error: "JORNADA_CERRADA" });
  });
});
