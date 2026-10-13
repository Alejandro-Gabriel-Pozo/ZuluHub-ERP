import { describe, expect, it } from "vitest";
import { ESTADOS_DE_SOLICITUD, type EstadoDeSolicitud } from "./estados";
import {
  PLAZO_PARA_VERIFICAR_EN_MS,
  RETENCION_DE_CERRADAS_EN_MS,
  debeAnonimizarse,
  vencidaSinVerificar,
} from "./retencion";

const DIA = 86_400_000;
const T0 = new Date("2026-10-13T12:00:00.000Z");
const mas = (fecha: Date, ms: number) => new Date(fecha.getTime() + ms);

describe("plazos de la solicitud", () => {
  it("sin verificar vence a los 7 días y las cerradas se anonimizan a los 90", () => {
    expect(PLAZO_PARA_VERIFICAR_EN_MS).toBe(7 * DIA);
    expect(PLAZO_PARA_VERIFICAR_EN_MS).toBe(604_800_000);
    expect(RETENCION_DE_CERRADAS_EN_MS).toBe(90 * DIA);
    expect(RETENCION_DE_CERRADAS_EN_MS).toBe(7_776_000_000);
  });
});

describe("vencidaSinVerificar", () => {
  const nueva = (creadaEn: Date) => ({ estado: "NUEVA" as const, creadaEn });

  it("hasta el último milisegundo de los 7 días vale; en el instante exacto vence", () => {
    expect(vencidaSinVerificar(nueva(T0), T0)).toBe(false);
    expect(vencidaSinVerificar(nueva(T0), mas(T0, 3 * DIA))).toBe(false);
    expect(vencidaSinVerificar(nueva(T0), mas(T0, 7 * DIA - 1))).toBe(false);
    expect(vencidaSinVerificar(nueva(T0), mas(T0, 7 * DIA))).toBe(true);
    expect(vencidaSinVerificar(nueva(T0), mas(T0, 7 * DIA + 1))).toBe(true);
    expect(vencidaSinVerificar(nueva(T0), mas(T0, 400 * DIA))).toBe(true);
  });

  it("con una fecha de recepción posterior a ahora no está vencida", () => {
    expect(vencidaSinVerificar(nueva(mas(T0, DIA)), T0)).toBe(false);
  });

  it("solo vence una NUEVA: ninguno de los otros cinco estados, por viejos que sean", () => {
    for (const estado of ESTADOS_DE_SOLICITUD.filter((e) => e !== "NUEVA")) {
      expect(vencidaSinVerificar({ estado, creadaEn: T0 }, mas(T0, 400 * DIA)), estado).toBe(false);
    }
  });
});

describe("debeAnonimizarse", () => {
  const cerrada = (
    estado: EstadoDeSolicitud,
    decididaEn: Date | null,
    anonimizadaEn: Date | null = null,
  ) => ({ estado, decididaEn, anonimizadaEn });

  it("una cerrada sin anonimizar: hasta el último milisegundo de los 90 días conserva sus datos; en el instante exacto toca", () => {
    for (const estado of ["ALTA_CREADA", "RECHAZADA", "SPAM"] as const) {
      expect(debeAnonimizarse(cerrada(estado, T0), T0), estado).toBe(false);
      expect(debeAnonimizarse(cerrada(estado, T0), mas(T0, 89 * DIA)), estado).toBe(false);
      expect(debeAnonimizarse(cerrada(estado, T0), mas(T0, 90 * DIA - 1)), estado).toBe(false);
      expect(debeAnonimizarse(cerrada(estado, T0), mas(T0, 90 * DIA)), estado).toBe(true);
      expect(debeAnonimizarse(cerrada(estado, T0), mas(T0, 90 * DIA + 1)), estado).toBe(true);
      expect(debeAnonimizarse(cerrada(estado, T0), mas(T0, 1000 * DIA)), estado).toBe(true);
    }
  });

  it("una abierta nunca se anonimiza, por vieja que sea (aunque tuviera fechas)", () => {
    for (const estado of ["NUEVA", "VERIFICADA", "APROBADA"] as const) {
      expect(debeAnonimizarse(cerrada(estado, T0), mas(T0, 1000 * DIA)), estado).toBe(false);
      expect(debeAnonimizarse(cerrada(estado, null), mas(T0, 1000 * DIA)), estado).toBe(false);
    }
  });

  it("la que ya se anonimizó no se anonimiza de nuevo", () => {
    expect(debeAnonimizarse(cerrada("RECHAZADA", T0, mas(T0, 91 * DIA)), mas(T0, 500 * DIA))).toBe(
      false,
    );
  });

  it("sin fecha de decisión no hay desde cuándo contar: no toca", () => {
    expect(debeAnonimizarse(cerrada("RECHAZADA", null), mas(T0, 500 * DIA))).toBe(false);
  });
});
