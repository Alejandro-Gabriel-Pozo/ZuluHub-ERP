import { afterEach, describe, expect, it, vi } from "vitest";
import { desplazamientoParaNoCruzarLaMedianoche } from "./reloj-de-la-corrida";

const HORA = 3_600_000;
/** `HH:MM` de Buenos Aires del 15/11/2026 como instante (UTC-3). */
const local = (hhmm: string): number => Date.parse(`2026-11-15T${hhmm}:00-03:00`);
const fechaLocal = (instante: number): string =>
  new Date(instante - 3 * HORA).toISOString().slice(0, 10);

describe("reloj de la corrida: no cruza la medianoche de Buenos Aires", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it("a mediodía no se desplaza; en los últimos 20 minutos del día se atrasa una hora (borde exacto: 23:40)", () => {
    expect(desplazamientoParaNoCruzarLaMedianoche(local("12:00"))).toBe(0);
    expect(desplazamientoParaNoCruzarLaMedianoche(local("23:39"))).toBe(0);
    expect(desplazamientoParaNoCruzarLaMedianoche(local("23:41"))).toBe(HORA);
    expect(desplazamientoParaNoCruzarLaMedianoche(local("23:59"))).toBe(HORA);
    expect(desplazamientoParaNoCruzarLaMedianoche(local("00:00"))).toBe(0);
  });

  it("un archivo que arranca 23:55 y corre diez minutos sigue en la misma fecha de negocio (sin esto, cruzaba)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(local("23:55"));
    vi.resetModules();
    const { ahoraDeLaCorrida } = await import("./reloj-de-la-corrida");
    const al_arrancar = fechaLocal(ahoraDeLaCorrida().getTime());
    vi.setSystemTime(local("23:55") + 10 * 60_000);
    const diez_minutos_despues = fechaLocal(ahoraDeLaCorrida().getTime());
    expect(al_arrancar).toBe("2026-11-15");
    expect(diez_minutos_despues).toBe(al_arrancar);
    // Y el reloj sigue avanzando (no queda congelado).
    vi.setSystemTime(local("23:55") + 11 * 60_000);
    expect(ahoraDeLaCorrida().getTime()).toBeGreaterThan(local("23:55") + 10 * 60_000 - HORA);
  });
});
