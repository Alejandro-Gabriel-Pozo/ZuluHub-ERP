import { describe, expect, it } from "vitest";
import { periodoDeLaExportacionValido } from "./limites";

describe("el período de la exportación", () => {
  it("acepta hasta 12 meses justos: del 01/07/2026 al 30/06/2027", () => {
    expect(periodoDeLaExportacionValido("2026-07-01", "2027-06-30")).toBe(true);
  });
  it("rechaza un día más: el 01/07/2027 ya son más de 12 meses", () => {
    expect(periodoDeLaExportacionValido("2026-07-01", "2027-07-01")).toBe(false);
  });
  it("acepta un solo día, y rechaza el período al revés", () => {
    expect(periodoDeLaExportacionValido("2026-07-01", "2026-07-01")).toBe(true);
    expect(periodoDeLaExportacionValido("2026-07-02", "2026-07-01")).toBe(false);
  });
  it("un 29/02 de año bisiesto: el límite sigue siendo el día equivalente del año siguiente", () => {
    expect(periodoDeLaExportacionValido("2028-02-29", "2029-02-28")).toBe(true);
    expect(periodoDeLaExportacionValido("2028-02-29", "2029-03-01")).toBe(false);
  });
  it("lo que no es una fecha civil se rechaza", () => {
    expect(periodoDeLaExportacionValido("ayer", "2026-07-01")).toBe(false);
    expect(periodoDeLaExportacionValido("2026-07-01", "")).toBe(false);
  });
});
