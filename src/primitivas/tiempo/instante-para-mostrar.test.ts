import { describe, expect, it } from "vitest";
import { instanteParaMostrar } from "./instante-para-mostrar";

describe("instanteParaMostrar («DD/MM/AAAA hh:mm» en la zona de Argentina)", () => {
  it("lleva el instante UTC a la hora de Argentina (UTC-3)", () => {
    expect(instanteParaMostrar(new Date("2026-11-10T01:09:00Z"))).toBe("09/11/2026 22:09");
  });

  it("cruza la medianoche argentina: 02:59 UTC es 23:59 del día anterior y 03:00 UTC ya es el día siguiente", () => {
    expect(instanteParaMostrar(new Date("2026-11-10T02:59:00Z"))).toBe("09/11/2026 23:59");
    expect(instanteParaMostrar(new Date("2026-11-10T03:00:00Z"))).toBe("10/11/2026 00:00");
  });

  it("día, mes, hora y minuto siempre de dos dígitos y el año de cuatro", () => {
    expect(instanteParaMostrar(new Date("2026-03-05T12:05:00Z"))).toBe("05/03/2026 09:05");
  });

  it("usa 24 horas: medianoche es 00:00, nunca 24:00", () => {
    expect(instanteParaMostrar(new Date("2026-01-01T03:00:00Z"))).toBe("01/01/2026 00:00");
  });

  it("respeta otra zona si se la pide y no depende de la zona del proceso", () => {
    const instante = new Date("2026-11-10T01:09:00Z");
    expect(instanteParaMostrar(instante, "UTC")).toBe("10/11/2026 01:09");
    expect(instanteParaMostrar(instante, "America/Los_Angeles")).toBe("09/11/2026 17:09");
  });

  it("falla cerrada: un instante inválido o una zona desconocida lanzan, no muestran una hora supuesta", () => {
    expect(() => instanteParaMostrar(new Date("no es una fecha"))).toThrow(RangeError);
    expect(() => instanteParaMostrar(new Date("2026-11-10T01:09:00Z"), "Marte/Olimpo")).toThrow(
      RangeError,
    );
  });
});
