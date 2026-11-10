import { describe, expect, it } from "vitest";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { CLASES_DE_MOVIMIENTO, type EstadoDeSesion } from "../estados";
import {
  decidirAnulacion,
  motivoNoAnulable,
  type EntradaDeAnulacion,
  type MovimientoAnulable,
} from "./anulacion";

const valor = (texto: string) => importeDesdeTexto(ARS, texto);
const OPERADOR = "persona-operador";
const OTRA = "persona-otra";

const egreso: MovimientoAnulable = {
  clase: "EGRESO_MANUAL",
  medioDePagoId: "efectivo",
  cuentaDeCobroId: null,
  importe: valor("-120.50"),
  registradoPor: OPERADOR,
};
const cobro: MovimientoAnulable = {
  clase: "COBRO",
  medioDePagoId: "debito",
  cuentaDeCobroId: "terminal-1",
  importe: valor("900"),
  registradoPor: OPERADOR,
  origen: { tipo: "ventas.cobranza_de_ticket", id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" },
};

const entrada = (c: Partial<EntradaDeAnulacion> = {}): EntradaDeAnulacion => ({
  movimiento: egreso,
  yaAnulado: false,
  sesion: "ABIERTA",
  actor: { personaId: OPERADOR, puedeAnularDeOtros: false },
  ...c,
});
const anular = (c: Partial<EntradaDeAnulacion> = {}, motivo: string | null = "Me equivoqué") =>
  decidirAnulacion({ ...entrada(c), motivo });

describe("anular un movimiento de caja", () => {
  it("el espejo es exacto: mismo medio, misma cuenta, importe opuesto y el motivo", () => {
    expect(anular()).toEqual({
      ok: true,
      valor: {
        clase: "ANULACION",
        medioDePagoId: "efectivo",
        cuentaDeCobroId: null,
        importe: valor("120.50"),
        motivo: "Me equivoqué",
      },
    });
    const ajusteConCuenta: MovimientoAnulable = {
      ...egreso,
      clase: "AJUSTE",
      medioDePagoId: "debito",
      cuentaDeCobroId: "terminal-1",
      importe: valor("33.33"),
    };
    expect(anular({ movimiento: ajusteConCuenta })).toEqual({
      ok: true,
      valor: {
        clase: "ANULACION",
        medioDePagoId: "debito",
        cuentaDeCobroId: "terminal-1",
        importe: valor("-33.33"),
        motivo: "Me equivoqué",
      },
    });
  });

  it("anular neutraliza: el original más su espejo suma cero", () => {
    for (const clase of ["INGRESO_MANUAL", "EGRESO_MANUAL", "AJUSTE"] as const) {
      const original: MovimientoAnulable = { ...egreso, clase, importe: valor("-77.07") };
      const r = anular({ movimiento: original });
      expect(r.ok).toBe(true);
      if (r.ok) expect(original.importe.unidades + r.valor.importe.unidades).toBe(0n);
    }
  });

  it("un cobro nunca se anula desde caja: MOVIMIENTO_CON_ORIGEN con su origen", () => {
    expect(
      anular({ movimiento: cobro, actor: { personaId: OTRA, puedeAnularDeOtros: true } }),
    ).toEqual({
      ok: false,
      error: {
        codigo: "MOVIMIENTO_CON_ORIGEN",
        origenTipo: "ventas.cobranza_de_ticket",
        origenId: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      },
    });
  });

  it("el fondo y una anulación no son anulables", () => {
    for (const clase of ["FONDO_INICIAL", "ANULACION"] as const) {
      expect(anular({ movimiento: { ...egreso, clase } })).toEqual({
        ok: false,
        error: "MOVIMIENTO_NO_ANULABLE",
      });
    }
  });

  it("solo son anulables, en total, ingreso, egreso y ajuste (de las 6 clases)", () => {
    const anulables = CLASES_DE_MOVIMIENTO.filter((clase) => {
      const movimiento = clase === "COBRO" ? cobro : { ...egreso, clase };
      return motivoNoAnulable(entrada({ movimiento })) === null;
    });
    expect(anulables).toEqual(["INGRESO_MANUAL", "EGRESO_MANUAL", "AJUSTE"]);
  });

  it("ya anulado: MOVIMIENTO_YA_ANULADO", () => {
    expect(anular({ yaAnulado: true })).toEqual({ ok: false, error: "MOVIMIENTO_YA_ANULADO" });
  });

  it("solo con la sesión ABIERTA: en cierre y cerrada tienen su error", () => {
    expect(anular({ sesion: "EN_CIERRE" })).toEqual({ ok: false, error: "SESION_EN_CIERRE" });
    expect(anular({ sesion: "CERRADA" })).toEqual({ ok: false, error: "SESION_CERRADA" });
  });

  it("el operador anula solo lo que cargó él; gerente y administrador, cualquiera", () => {
    expect(anular({ actor: { personaId: OTRA, puedeAnularDeOtros: false } })).toEqual({
      ok: false,
      error: "MOVIMIENTO_DE_OTRA_PERSONA",
    });
    expect(anular({ actor: { personaId: OTRA, puedeAnularDeOtros: true } }).ok).toBe(true);
    expect(anular({ actor: { personaId: OPERADOR, puedeAnularDeOtros: true } }).ok).toBe(true);
    expect(anular({ actor: { personaId: OPERADOR, puedeAnularDeOtros: false } }).ok).toBe(true);
  });

  it("el motivo es obligatorio y va al final", () => {
    expect(anular({}, null)).toEqual({ ok: false, error: "MOTIVO_INVALIDO" });
    expect(anular({}, "  ")).toEqual({ ok: false, error: "MOTIVO_INVALIDO" });
    expect(anular({ yaAnulado: true }, null)).toEqual({
      ok: false,
      error: "MOVIMIENTO_YA_ANULADO",
    });
  });

  it("el orden de los impedimentos: estructural, ya anulado, estado de la sesión, de quién es", () => {
    const todo = {
      yaAnulado: true,
      sesion: "CERRADA" as EstadoDeSesion,
      actor: { personaId: OTRA, puedeAnularDeOtros: false },
    };
    expect(anular({ ...todo, movimiento: cobro })).toMatchObject({
      error: { codigo: "MOVIMIENTO_CON_ORIGEN" },
    });
    expect(anular({ ...todo, movimiento: { ...egreso, clase: "FONDO_INICIAL" } })).toEqual({
      ok: false,
      error: "MOVIMIENTO_NO_ANULABLE",
    });
    expect(anular(todo)).toEqual({ ok: false, error: "MOVIMIENTO_YA_ANULADO" });
    expect(anular({ ...todo, yaAnulado: false })).toEqual({ ok: false, error: "SESION_CERRADA" });
    expect(anular({ ...todo, yaAnulado: false, sesion: "EN_CIERRE" })).toEqual({
      ok: false,
      error: "SESION_EN_CIERRE",
    });
    expect(anular({ ...todo, yaAnulado: false, sesion: "ABIERTA" })).toEqual({
      ok: false,
      error: "MOVIMIENTO_DE_OTRA_PERSONA",
    });
  });
});

describe("motivoNoAnulable (lo que muestra la consulta, con la misma regla)", () => {
  it("null cuando se puede anular", () => {
    expect(motivoNoAnulable(entrada())).toBeNull();
    expect(
      motivoNoAnulable(entrada({ actor: { personaId: OTRA, puedeAnularDeOtros: true } })),
    ).toBeNull();
  });
  it("cada impedimento tiene su motivo", () => {
    expect(motivoNoAnulable(entrada({ movimiento: cobro }))).toBe("CON_ORIGEN");
    expect(motivoNoAnulable(entrada({ movimiento: { ...egreso, clase: "FONDO_INICIAL" } }))).toBe(
      "NO_ANULABLE",
    );
    expect(motivoNoAnulable(entrada({ movimiento: { ...egreso, clase: "ANULACION" } }))).toBe(
      "NO_ANULABLE",
    );
    expect(motivoNoAnulable(entrada({ yaAnulado: true }))).toBe("NO_ANULABLE");
    expect(motivoNoAnulable(entrada({ sesion: "EN_CIERRE" }))).toBe("SESION_NO_ABIERTA");
    expect(motivoNoAnulable(entrada({ sesion: "CERRADA" }))).toBe("SESION_NO_ABIERTA");
    expect(
      motivoNoAnulable(entrada({ actor: { personaId: OTRA, puedeAnularDeOtros: false } })),
    ).toBe("DE_OTRA_PERSONA");
  });
  it("coincide con decidirAnulacion en todas las combinaciones", () => {
    const movimientos: MovimientoAnulable[] = [
      egreso,
      cobro,
      ...(["FONDO_INICIAL", "ANULACION", "AJUSTE", "INGRESO_MANUAL"] as const).map((clase) => ({
        ...egreso,
        clase,
      })),
    ];
    for (const movimiento of movimientos) {
      for (const yaAnulado of [false, true]) {
        for (const sesion of ["ABIERTA", "EN_CIERRE", "CERRADA"] as const) {
          for (const actor of [
            { personaId: OPERADOR, puedeAnularDeOtros: false },
            { personaId: OTRA, puedeAnularDeOtros: false },
            { personaId: OTRA, puedeAnularDeOtros: true },
          ]) {
            const e = { movimiento, yaAnulado, sesion, actor };
            expect(motivoNoAnulable(e) === null).toBe(decidirAnulacion({ ...e, motivo: "ok" }).ok);
          }
        }
      }
    }
  });
});
