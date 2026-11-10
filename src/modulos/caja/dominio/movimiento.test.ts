import { describe, expect, it } from "vitest";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { CLASES_DE_MOVIMIENTO, type ClaseDeMovimiento } from "../estados";
import {
  CLASES_ANULABLES,
  CLASES_CON_MOTIVO,
  decidirAjuste,
  decidirFondoInicial,
  decidirMovimientoManual,
  egresoSuperaElEfectivo,
  esSoloDeEfectivo,
  motivoRequerido,
  signoValido,
  validarJornadaACorregir,
} from "./movimiento";

const ars = (monto: string) => ({ moneda: "ARS", monto });
const valor = (texto: string) => importeDesdeTexto(ARS, texto);
const fecha = (texto: string) => texto as FechaCivil;

describe("regla de signo de cada clase (movimiento_caja_signo_ck)", () => {
  /** El CHECK de 0027 transcripto, por signo del importe: -1, 0 y +1. */
  const esperado: Record<ClaseDeMovimiento, readonly [boolean, boolean, boolean]> = {
    COBRO: [false, false, true],
    INGRESO_MANUAL: [false, false, true],
    EGRESO_MANUAL: [true, false, false],
    FONDO_INICIAL: [false, true, true],
    AJUSTE: [true, false, true],
    ANULACION: [true, false, true],
  };
  it("coincide con el CHECK en las 6 clases y los 3 signos", () => {
    for (const clase of CLASES_DE_MOVIMIENTO) {
      const [negativo, cero, positivo] = esperado[clase];
      expect(signoValido(clase, valor("-0.01")), `${clase} negativo`).toBe(negativo);
      expect(signoValido(clase, valor("0")), `${clase} cero`).toBe(cero);
      expect(signoValido(clase, valor("0.01")), `${clase} positivo`).toBe(positivo);
    }
  });
});

describe("clases con motivo, anulables y solo de efectivo", () => {
  it("piden motivo ingreso, egreso, ajuste y anulación (movimiento_caja_motivo_requerido_ck)", () => {
    expect([...CLASES_CON_MOTIVO]).toEqual([
      "INGRESO_MANUAL",
      "EGRESO_MANUAL",
      "AJUSTE",
      "ANULACION",
    ]);
    for (const clase of CLASES_DE_MOVIMIENTO) {
      expect(motivoRequerido(clase)).toBe(
        ["INGRESO_MANUAL", "EGRESO_MANUAL", "AJUSTE", "ANULACION"].includes(clase),
      );
    }
  });
  it("se anulan ingreso, egreso y ajuste", () => {
    expect([...CLASES_ANULABLES]).toEqual(["INGRESO_MANUAL", "EGRESO_MANUAL", "AJUSTE"]);
  });
  it("son solo de efectivo el fondo, el ingreso y el egreso", () => {
    for (const clase of CLASES_DE_MOVIMIENTO) {
      expect(esSoloDeEfectivo(clase)).toBe(
        ["FONDO_INICIAL", "INGRESO_MANUAL", "EGRESO_MANUAL"].includes(clase),
      );
    }
  });
});

describe("fondo inicial", () => {
  it("es >= 0: cero vale, negativo no", () => {
    expect(decidirFondoInicial(ars("0"))).toEqual({ ok: true, valor: valor("0") });
    expect(decidirFondoInicial(ars("15000.50"))).toEqual({ ok: true, valor: valor("15000.50") });
    expect(decidirFondoInicial(ars("-1"))).toEqual({ ok: false, error: "IMPORTE_INVALIDO" });
    expect(decidirFondoInicial({ moneda: "USD", monto: "1" })).toEqual({
      ok: false,
      error: "MONEDA_NO_SOPORTADA",
    });
  });
});

describe("ingreso y egreso manual", () => {
  it("el ingreso suma y el egreso se guarda negativo, con el motivo canónico", () => {
    expect(
      decidirMovimientoManual({
        sentido: "INGRESO",
        importe: ars("100.25"),
        motivo: " Cambio  chico ",
      }),
    ).toEqual({
      ok: true,
      valor: { clase: "INGRESO_MANUAL", importe: valor("100.25"), motivo: "Cambio chico" },
    });
    expect(
      decidirMovimientoManual({ sentido: "EGRESO", importe: ars("100.25"), motivo: "Flete" }),
    ).toEqual({
      ok: true,
      valor: { clase: "EGRESO_MANUAL", importe: valor("-100.25"), motivo: "Flete" },
    });
  });
  it("el monto tiene que ser positivo (cero y negativo no) y bien escrito", () => {
    for (const monto of ["0", "-5", "10.001", "1e3"]) {
      expect(
        decidirMovimientoManual({ sentido: "INGRESO", importe: ars(monto), motivo: "x" }),
      ).toEqual({
        ok: false,
        error: "IMPORTE_INVALIDO",
      });
    }
  });
  it("el motivo es obligatorio; el importe se mira primero", () => {
    expect(decidirMovimientoManual({ sentido: "EGRESO", importe: ars("5"), motivo: null })).toEqual(
      { ok: false, error: "MOTIVO_INVALIDO" },
    );
    expect(decidirMovimientoManual({ sentido: "EGRESO", importe: ars("0"), motivo: null })).toEqual(
      { ok: false, error: "IMPORTE_INVALIDO" },
    );
  });
});

describe("egreso mayor al efectivo esperado", () => {
  it("solo avisa si el esperado queda por debajo de cero", () => {
    expect(egresoSuperaElEfectivo(valor("100"), valor("-100.01"))).toBe(true);
    expect(egresoSuperaElEfectivo(valor("100"), valor("-100"))).toBe(false);
    expect(egresoSuperaElEfectivo(valor("100"), valor("-99.99"))).toBe(false);
    expect(egresoSuperaElEfectivo(valor("-5"), valor("-1"))).toBe(true);
  });
});

describe("jornada que corrige un ajuste (e3 §3.11.3)", () => {
  const cerrada = { estado: "CERRADA" } as const;
  it("tiene que existir, estar CERRADA y ser anterior a la de la sesión, en ese orden", () => {
    expect(validarJornadaACorregir(fecha("2026-11-08"), null, fecha("2026-11-10"))).toEqual({
      ok: false,
      error: "JORNADA_A_CORREGIR_NO_ENCONTRADA",
    });
    expect(
      validarJornadaACorregir(fecha("2026-11-10"), { estado: "EN_AUDITORIA" }, fecha("2026-11-10")),
    ).toEqual({
      ok: false,
      error: "JORNADA_A_CORREGIR_NO_CERRADA",
    });
    expect(
      validarJornadaACorregir(fecha("2026-11-10"), { estado: "ABIERTA" }, fecha("2026-11-09")),
    ).toEqual({
      ok: false,
      error: "JORNADA_A_CORREGIR_NO_CERRADA",
    });
    expect(validarJornadaACorregir(fecha("2026-11-10"), cerrada, fecha("2026-11-10"))).toEqual({
      ok: false,
      error: "JORNADA_A_CORREGIR_NO_ANTERIOR",
    });
    expect(validarJornadaACorregir(fecha("2026-11-11"), cerrada, fecha("2026-11-10"))).toEqual({
      ok: false,
      error: "JORNADA_A_CORREGIR_NO_ANTERIOR",
    });
    expect(validarJornadaACorregir(fecha("2026-11-09"), cerrada, fecha("2026-11-10"))).toEqual({
      ok: true,
      valor: null,
    });
    expect(validarJornadaACorregir(fecha("2025-12-31"), cerrada, fecha("2026-01-01"))).toEqual({
      ok: true,
      valor: null,
    });
  });
});

describe("ajuste", () => {
  const base = {
    importe: ars("-250.40"),
    motivo: "Billete falso",
    corrigeJornada: null,
    jornadaACorregir: null,
    fechaDeLaSesion: fecha("2026-11-10"),
  };
  it("lleva signo, no cero, motivo y sin enlace es un ajuste común", () => {
    expect(decidirAjuste(base)).toEqual({
      ok: true,
      valor: { importe: valor("-250.40"), motivo: "Billete falso", corrigeJornada: null },
    });
    expect(decidirAjuste({ ...base, importe: ars("10") }).ok).toBe(true);
  });
  it("rechaza el cero, la moneda ajena y el importe mal escrito", () => {
    expect(decidirAjuste({ ...base, importe: ars("0") })).toEqual({
      ok: false,
      error: "IMPORTE_INVALIDO",
    });
    expect(decidirAjuste({ ...base, importe: ars("-0") })).toEqual({
      ok: false,
      error: "IMPORTE_INVALIDO",
    });
    expect(decidirAjuste({ ...base, importe: { moneda: "EUR", monto: "1" } })).toEqual({
      ok: false,
      error: "MONEDA_NO_SOPORTADA",
    });
  });
  it("el motivo es obligatorio", () => {
    expect(decidirAjuste({ ...base, motivo: "" })).toEqual({ ok: false, error: "MOTIVO_INVALIDO" });
  });
  it("con enlace valida la jornada a corregir; sin enlace no la mira", () => {
    const con = { ...base, corrigeJornada: fecha("2026-11-08") };
    expect(decidirAjuste({ ...con, jornadaACorregir: { estado: "CERRADA" } })).toEqual({
      ok: true,
      valor: {
        importe: valor("-250.40"),
        motivo: "Billete falso",
        corrigeJornada: fecha("2026-11-08"),
      },
    });
    expect(decidirAjuste(con)).toEqual({ ok: false, error: "JORNADA_A_CORREGIR_NO_ENCONTRADA" });
    expect(decidirAjuste({ ...con, jornadaACorregir: { estado: "EN_AUDITORIA" } })).toEqual({
      ok: false,
      error: "JORNADA_A_CORREGIR_NO_CERRADA",
    });
    expect(decidirAjuste({ ...base, jornadaACorregir: { estado: "ABIERTA" } }).ok).toBe(true);
  });
  it("el importe se mira antes que el motivo y el motivo antes que el enlace", () => {
    expect(decidirAjuste({ ...base, importe: ars("0"), motivo: "" })).toEqual({
      ok: false,
      error: "IMPORTE_INVALIDO",
    });
    expect(decidirAjuste({ ...base, motivo: "", corrigeJornada: fecha("2026-11-08") })).toEqual({
      ok: false,
      error: "MOTIVO_INVALIDO",
    });
  });
});
