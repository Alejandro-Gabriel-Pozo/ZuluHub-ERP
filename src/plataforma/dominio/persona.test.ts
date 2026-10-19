import { describe, expect, it } from "vitest";
import { decidirReactivacionDePersona, decidirSuspensionDePersona } from "./persona";

const activa = { activoGlobal: true };
const suspendida = { activoGlobal: false };
const error = <E>(e: E) => ({ ok: false, error: e });

describe("decidirSuspensionDePersona", () => {
  it("una persona activa con motivo se puede suspender; el motivo sale recortado", () => {
    expect(decidirSuspensionDePersona(activa, "  fraude en la cuenta ")).toEqual({
      ok: true,
      valor: { motivo: "fraude en la cuenta" },
    });
  });

  it("sin motivo es MOTIVO_OBLIGATORIO (vacío, espacios, saltos de línea)", () => {
    for (const motivo of ["", "   ", "\n\t "]) {
      expect(decidirSuspensionDePersona(activa, motivo), motivo).toEqual(
        error("MOTIVO_OBLIGATORIO"),
      );
    }
  });

  it("una persona ya suspendida es YA_SUSPENDIDA, y gana sobre el motivo vacío", () => {
    expect(decidirSuspensionDePersona(suspendida, "otra vez")).toEqual(error("YA_SUSPENDIDA"));
    expect(decidirSuspensionDePersona(suspendida, "")).toEqual(error("YA_SUSPENDIDA"));
  });
});

describe("decidirReactivacionDePersona", () => {
  it("una persona suspendida se puede reactivar", () => {
    expect(decidirReactivacionDePersona(suspendida)).toEqual({ ok: true, valor: null });
  });

  it("una persona activa es NO_SUSPENDIDA", () => {
    expect(decidirReactivacionDePersona(activa)).toEqual(error("NO_SUSPENDIDA"));
  });
});
