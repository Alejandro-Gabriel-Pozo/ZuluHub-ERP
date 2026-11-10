import { describe, expect, it } from "vitest";
import {
  controlesDelAporte,
  impideCerrar,
  pideReconocimiento,
  type ControlDelDia,
} from "../../cierre/publico";
import { CONTROLES_DE_CAJA } from "./controles";

describe("los controles de caja y su severidad (e3b §4.2, decisión 167)", () => {
  it("son seis, con la severidad del documento", () => {
    expect(Object.values(CONTROLES_DE_CAJA).map((c) => [c.clave, c.severidad])).toEqual([
      ["caja.sesiones_sin_cerrar", "BLOQUEA"],
      ["caja.diferencia_de_arqueo", "RECONOCIBLE"],
      ["caja.conciliacion_por_medio", "RECONOCIBLE"],
      ["caja.cobrado_contra_ticket", "RECONOCIBLE"],
      ["caja.cobros_corregidos", "INFORMA"],
      ["caja.ajustes_a_jornadas_cerradas", "INFORMA"],
    ]);
  });

  it("solo las cajas sin cerrar impiden cerrar", () => {
    const bloquean = Object.values(CONTROLES_DE_CAJA).filter((c) =>
      impideCerrar({ severidad: c.severidad, cantidad: 1 }),
    );
    expect(bloquean.map((c) => c.clave)).toEqual(["caja.sesiones_sin_cerrar"]);
    const reconocibles = Object.values(CONTROLES_DE_CAJA).filter((c) =>
      pideReconocimiento({ severidad: c.severidad, cantidad: 1 }),
    );
    expect(reconocibles.map((c) => c.clave)).toEqual([
      "caja.diferencia_de_arqueo",
      "caja.conciliacion_por_medio",
      "caja.cobrado_contra_ticket",
    ]);
  });

  it("cada clave cumple el contrato del punto de enganche de cierre (módulo `caja`, forma y largo)", () => {
    const controles: ControlDelDia[] = Object.values(CONTROLES_DE_CAJA).map((c) => ({
      modulo: "caja",
      clave: c.clave,
      severidad: c.severidad,
      cantidad: 0,
      huellaDelDetalle: "a".repeat(64),
      referencias: [],
    }));
    expect(controlesDelAporte("caja", controles).ok).toBe(true);
  });
});
