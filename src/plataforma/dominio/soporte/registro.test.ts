import { describe, expect, it } from "vitest";
import { resultadoDeUnaAccionExplicada, resultadoDeUnaAceptacionExplicada } from "./registro";

describe("resultadoDeUnaAccionExplicada: el motivo que queda en la constancia", () => {
  it("permitida", () => {
    expect(resultadoDeUnaAccionExplicada({ ok: true, valor: null })).toBe("PERMITIDA");
  });

  it("un rechazo del guard es su motivo", () => {
    for (const motivo of [
      "SIN_PERMISO",
      "MODULO_NO_ACTIVO",
      "MODULO_EN_DESARROLLO",
      "SIN_CAPACIDAD",
    ] as const) {
      expect(resultadoDeUnaAccionExplicada({ ok: false, error: motivo })).toBe(motivo);
    }
  });

  it("una empresa que no opera es EMPRESA_NO_OPERA (el detalle va en la explicación, no en la constancia)", () => {
    expect(
      resultadoDeUnaAccionExplicada({
        ok: false,
        error: {
          codigo: "EMPRESA_NO_OPERA",
          empresaId: "e-1" as never,
          motivo: "TENANT_SUSPENDIDO",
        },
      }),
    ).toBe("EMPRESA_NO_OPERA");
  });
});

describe("resultadoDeUnaAceptacionExplicada", () => {
  it("si se aceptaría o ya se aceptó, el tipo de decisión", () => {
    expect(resultadoDeUnaAceptacionExplicada({ ok: true, valor: { tipo: "ACEPTAR" } })).toBe(
      "ACEPTAR",
    );
    expect(resultadoDeUnaAceptacionExplicada({ ok: true, valor: { tipo: "YA_ACEPTADA" } })).toBe(
      "YA_ACEPTADA",
    );
  });

  it("un error en texto es el texto", () => {
    expect(resultadoDeUnaAceptacionExplicada({ ok: false, error: "INVITACION_VENCIDA" })).toBe(
      "INVITACION_VENCIDA",
    );
    expect(resultadoDeUnaAceptacionExplicada({ ok: false, error: "YA_ES_MIEMBRO" })).toBe(
      "YA_ES_MIEMBRO",
    );
  });

  it("un error con detalle es su código", () => {
    expect(
      resultadoDeUnaAceptacionExplicada({
        ok: false,
        error: {
          codigo: "EMPRESA_NO_OPERA",
          empresaId: "e-1" as never,
          motivo: "EMPRESA_SUSPENDIDA",
        },
      }),
    ).toBe("EMPRESA_NO_OPERA");
    expect(
      resultadoDeUnaAceptacionExplicada({
        ok: false,
        error: { codigo: "ROL_DISTINTO_AL_ANTERIOR", empresaId: "e-1" as never },
      }),
    ).toBe("ROL_DISTINTO_AL_ANTERIOR");
  });
});
