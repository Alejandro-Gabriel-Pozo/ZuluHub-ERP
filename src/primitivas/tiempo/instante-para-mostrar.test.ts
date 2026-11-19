import { describe, expect, it } from "vitest";
import { fechaYHoraParaMostrar, horaParaMostrar } from "./instante-para-mostrar";

describe("instante para mostrar (zona de Argentina)", () => {
  it("00:30 UTC es 21:30 del día anterior; 03:00 UTC es 00:00 del mismo día", () => {
    expect(horaParaMostrar("2026-11-18T00:30:00.000Z")).toBe("21:30");
    expect(fechaYHoraParaMostrar("2026-11-18T00:30:00.000Z")).toBe("17/11/2026 21:30");
    expect(horaParaMostrar("2026-11-18T03:00:00.000Z")).toBe("00:00");
    expect(fechaYHoraParaMostrar("2026-11-18T03:00:00.000Z")).toBe("18/11/2026 00:00");
  });
  it("un instante con desfase se lleva a la hora de Argentina", () => {
    expect(fechaYHoraParaMostrar("2026-11-17T21:14:00-03:00")).toBe("17/11/2026 21:14");
    expect(horaParaMostrar("2026-11-18T09:05:07+00:00")).toBe("06:05");
  });
  it("cierra la medianoche: 02:59 UTC sigue en el día anterior", () => {
    expect(fechaYHoraParaMostrar("2026-01-01T02:59:59Z")).toBe("31/12/2025 23:59");
    expect(horaParaMostrar("2026-01-01T02:59:59Z")).toBe("23:59");
  });
  it("lo que no es un instante ISO con zona lanza (nunca muestra a medias)", () => {
    for (const malo of [
      "",
      "17/11/2026 21:14",
      "2026-11-18",
      "2026-11-18T00:30:00",
      "2026-13-40T00:00:00Z",
      "ayer",
    ]) {
      expect(() => horaParaMostrar(malo), malo).toThrow(RangeError);
      expect(() => fechaYHoraParaMostrar(malo), malo).toThrow(RangeError);
    }
  });
});
