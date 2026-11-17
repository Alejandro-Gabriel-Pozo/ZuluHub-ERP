import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `instanteLocal` y lo que se arma con él (`fechaDelDia`, los contextos «de mañana») no se mueven si el reloj real cruza la medianoche de Buenos Aires
 * (03:00 UTC) en medio de una prueba. Fuerza el cruce con un reloj falso: sin el «ahora» fijo del archivo, la segunda llamada daba el día siguiente.
 */
describe("instanteLocal: el «hoy» es el del archivo, no el del reloj", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it("dos llamadas a un lado y otro de la medianoche de Buenos Aires dan el mismo día", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T02:59:59.900Z"));
    vi.resetModules();
    const { instanteLocal, fechaLocal } = await import("./caja-operacion-apoyo");
    const antes = fechaLocal(instanteLocal(1, "10:00"));
    vi.setSystemTime(new Date("2026-11-15T03:00:00.500Z"));
    const despues = fechaLocal(instanteLocal(1, "10:00"));
    expect(antes).toBe("2026-11-15");
    expect(despues).toBe(antes);
  });

  it("con un «ahora» explícito sigue calculando desde ese instante", async () => {
    const { instanteLocal, fechaLocal } = await import("./caja-operacion-apoyo");
    expect(fechaLocal(instanteLocal(1, "10:00", new Date("2027-03-05T12:00:00Z")))).toBe(
      "2027-03-06",
    );
  });
});
