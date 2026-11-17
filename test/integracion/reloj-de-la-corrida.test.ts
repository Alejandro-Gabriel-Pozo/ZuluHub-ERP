import { afterEach, describe, expect, it, vi } from "vitest";
import {
  desplazamientoDeLaCorrida,
  desplazamientoParaNoCruzarLaMedianoche,
  instanteFijado,
} from "./reloj-de-la-corrida";

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

describe("reloj de la corrida: fijable con PEDERNAL_RELOJ_FIJO", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([undefined, ""])("sin pedir nada («%s») no hay instante fijo", (valor) => {
    expect(instanteFijado(valor)).toBeNull();
  });

  it.each([
    ["2026-11-16T23:30:00-03:00", Date.parse("2026-11-17T02:30:00Z")],
    ["2026-11-17T00:30:00-03:00", Date.parse("2026-11-17T03:30:00Z")],
    ["2026-11-16T00:00:00Z", Date.parse("2026-11-16T00:00:00Z")],
    ["2026-11-16T00:00:00.500+00:00", Date.parse("2026-11-16T00:00:00.500Z")],
  ])("«%s» se acepta", (texto, esperado) => {
    expect(instanteFijado(texto)).toBe(esperado);
  });

  it.each([
    "2026-11-16",
    "2026-11-16T23:30:00",
    "2026-11-16 23:30:00-03:00",
    "2026-11-16T23:30:00-0300",
    "2026-13-40T00:00:00Z",
    "2026-11-16T25:00:00Z",
    "ayer",
    " 2026-11-16T23:30:00Z",
    "2026-11-16T23:30:00Z\n",
    "1700000000000",
  ])("«%s» se rechaza: la carga falla en vez de ignorarlo", (texto) => {
    expect(() => instanteFijado(texto)).toThrow("PEDERNAL_RELOJ_FIJO");
  });

  it("con un instante fijo se corre hasta él; sin fijo vale el corrimiento de la medianoche", () => {
    const real = local("12:00");
    expect(desplazamientoDeLaCorrida(real, local("23:30"))).toBe(real - local("23:30"));
    expect(desplazamientoDeLaCorrida(local("23:55"), null)).toBe(HORA);
    expect(desplazamientoDeLaCorrida(real, null)).toBe(0);
  });

  /** Carga el módulo de cero con la variable puesta y el reloj real en `real`. */
  async function cargar(fijo: string | undefined, real: number) {
    vi.useFakeTimers();
    vi.setSystemTime(real);
    if (fijo !== undefined) vi.stubEnv("PEDERNAL_RELOJ_FIJO", fijo);
    vi.resetModules();
    return import("./reloj-de-la-corrida");
  }

  it.each([
    ["23:30 de Argentina", "2026-11-16T23:30:00-03:00", "2026-11-16"],
    ["00:30 de Argentina", "2026-11-17T00:30:00-03:00", "2026-11-17"],
    ["el cambio de día UTC (21:00 de Argentina)", "2026-11-17T00:00:00Z", "2026-11-16"],
    ["un minuto antes del cambio de día UTC", "2026-11-16T23:59:00Z", "2026-11-16"],
  ])("fijado a %s: «hoy» es el día de Argentina de ese instante", async (_nombre, fijo, hoy) => {
    const reloj = await cargar(fijo, local("12:00"));
    expect(reloj.ahoraDeLaCorrida().getTime()).toBe(Date.parse(fijo));
    expect(reloj.hoyDeNegocio()).toBe(hoy);
  });

  it("el reloj fijado AVANZA como el real: a las 23:30 de Argentina, 40 minutos después es el día siguiente", async () => {
    const real = local("12:00");
    const reloj = await cargar("2026-11-15T23:30:00-03:00", real);
    expect(reloj.hoyDeNegocio()).toBe("2026-11-15");
    vi.setSystemTime(real + 29 * 60_000);
    expect(reloj.hoyDeNegocio()).toBe("2026-11-15");
    vi.setSystemTime(real + 31 * 60_000);
    expect(reloj.hoyDeNegocio()).toBe("2026-11-16");
  });

  it("fijado, no se aplica el corrimiento de la medianoche (un 23:55 pedido es 23:55)", async () => {
    const reloj = await cargar("2026-11-15T23:55:00-03:00", local("12:00"));
    expect(reloj.ahoraDeLaCorrida().getTime()).toBe(local("23:55"));
  });

  it("sin la variable, el reloj es el real (con el corrimiento si arranca cerca de la medianoche)", async () => {
    const reloj = await cargar(undefined, local("12:00"));
    expect(reloj.ahoraDeLaCorrida().getTime()).toBe(local("12:00"));
    expect(reloj.hoyDeNegocio()).toBe("2026-11-15");
    const tarde = await cargar(undefined, local("23:55"));
    expect(tarde.ahoraDeLaCorrida().getTime()).toBe(local("23:55") - HORA);
  });

  it("una variable mal formada hace fallar la carga del módulo (no se ignora)", async () => {
    await expect(cargar("mañana a la noche", local("12:00"))).rejects.toThrow(
      "PEDERNAL_RELOJ_FIJO",
    );
  });
});
