import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * ADR-007, despacho inmediato: `despacharDespuesDeConfirmar` programa el intento con `after()` de Next (que corre
 * después de responder). Se reemplazan `next/server` y la composición: lo que se prueba es QUÉ se programa y
 * que nada de lo que pase adentro llegue a quien encoló.
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted(() => ({
  programadas: [] as (() => Promise<void> | void)[],
  despachar: undefined as unknown as Mock<
    (
      ids: readonly string[],
      ahora: Date,
      opciones?: { esperarHastaTerminar?: boolean },
    ) => Promise<void>
  >,
  procesador: undefined as unknown as Mock<
    () => { despacharAhora: unknown; despacharPorClaves: unknown }
  >,
  porClaves: undefined as unknown as Mock<
    (
      empresa: string,
      claves: readonly string[],
      ahora: Date,
      opciones?: { esperarHastaTerminar?: boolean },
    ) => Promise<void>
  >,
}));
vi.mock("next/server", () => ({
  after: (tarea: () => Promise<void> | void) => {
    mundo.programadas.push(tarea);
  },
}));
vi.mock("../../apps/web/servidor/composicion", () => {
  mundo.despachar = vi.fn(() => Promise.resolve());
  mundo.porClaves = vi.fn(() => Promise.resolve());
  mundo.procesador = vi.fn(() => ({
    despacharAhora: mundo.despachar,
    despacharPorClaves: mundo.porClaves,
  }));
  return { trabajos: { procesador: mundo.procesador } };
});

import {
  despacharDespuesDeConfirmar,
  despacharPorClavesDespuesDeConfirmar,
} from "../../apps/web/servidor/despacho-inmediato";
import { empresaId } from "../../src/primitivas/identificadores/marca";

beforeEach(() => {
  mundo.programadas.length = 0;
  mundo.despachar.mockClear();
  mundo.porClaves.mockClear();
  mundo.procesador.mockClear();
  mundo.despachar.mockImplementation(() => Promise.resolve());
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T12:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("despacharDespuesDeConfirmar", () => {
  it("programa UN intento con after() y no ejecuta nada todavía (la respuesta no espera)", () => {
    despacharDespuesDeConfirmar(["t1", "t2"]);
    expect(mundo.programadas).toHaveLength(1);
    expect(mundo.procesador).not.toHaveBeenCalled();
    expect(mundo.despachar).not.toHaveBeenCalled();
  });

  it("al correr, despacha exactamente esos ids con el reloj de ese momento", async () => {
    despacharDespuesDeConfirmar(["t1", "t2"]);
    vi.setSystemTime(new Date("2026-10-14T12:00:07.000Z"));
    await mundo.programadas[0]?.();
    expect(mundo.despachar).toHaveBeenCalledTimes(1);
    expect(mundo.despachar).toHaveBeenCalledWith(
      ["t1", "t2"],
      new Date("2026-10-14T12:00:07.000Z"),
      // `after()` corre con la respuesta ya enviada: espera a que termine (el tope de 5 s no aplica).
      { esperarHastaTerminar: true },
    );
  });

  it("sin ids no programa nada", () => {
    despacharDespuesDeConfirmar([]);
    expect(mundo.programadas).toEqual([]);
  });

  it("si despachar falla o el procesador no se puede armar, no lanza y deja registro por tipo, sin mensaje", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mundo.procesador.mockImplementationOnce(() => {
      throw Object.assign(new Error("falta PEDERNAL_RESEND_API_KEY clave=zzz"), {
        name: "ErrorDeEntorno",
      });
    });
    despacharDespuesDeConfirmar(["t1"]);
    await expect(mundo.programadas[0]?.()).resolves.toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- justamente se prueba lo que no es un Error
    mundo.despachar.mockImplementationOnce(() => Promise.reject("texto crudo"));
    despacharDespuesDeConfirmar(["t2"]);
    await expect(mundo.programadas[1]?.()).resolves.toBeUndefined();
    expect(registro.mock.calls.map((c) => c.join(" "))).toEqual([
      "[despacho] no se pudo despachar de inmediato (ErrorDeEntorno); queda para el cron",
      "[despacho] no se pudo despachar de inmediato (falla que no es un Error); queda para el cron",
    ]);
  });
});

describe("despacharPorClavesDespuesDeConfirmar", () => {
  const empresa = empresaId("11111111-1111-4111-8111-111111111111");

  it("programa UN intento con after() y no ejecuta nada todavía", () => {
    despacharPorClavesDespuesDeConfirmar(empresa, ["fiscal.validar:x:1"]);
    expect(mundo.programadas).toHaveLength(1);
    expect(mundo.procesador).not.toHaveBeenCalled();
    expect(mundo.porClaves).not.toHaveBeenCalled();
  });

  it("al correr, despacha las claves de ESA empresa con el reloj de ese momento", async () => {
    despacharPorClavesDespuesDeConfirmar(empresa, ["fiscal.validar:x:1"]);
    vi.setSystemTime(new Date("2026-10-14T12:00:09.000Z"));
    await mundo.programadas[0]?.();
    expect(mundo.porClaves).toHaveBeenCalledTimes(1);
    expect(mundo.porClaves).toHaveBeenCalledWith(
      empresa,
      ["fiscal.validar:x:1"],
      new Date("2026-10-14T12:00:09.000Z"),
      { esperarHastaTerminar: true },
    );
  });

  it("sin claves no programa nada", () => {
    despacharPorClavesDespuesDeConfirmar(empresa, []);
    expect(mundo.programadas).toEqual([]);
  });

  it("si no se puede armar el procesador, no lanza y deja registro por tipo, sin mensaje", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mundo.procesador.mockImplementationOnce(() => {
      throw Object.assign(new Error("falta PEDERNAL_CLAVE_CERTIFICADOS clave=zzz"), {
        name: "ErrorDeEntorno",
      });
    });
    despacharPorClavesDespuesDeConfirmar(empresa, ["k"]);
    await expect(mundo.programadas[0]?.()).resolves.toBeUndefined();
    expect(registro.mock.calls.map((c) => c.join(" "))).toEqual([
      "[despacho] no se pudo despachar de inmediato (ErrorDeEntorno); queda para el cron",
    ]);
  });
});
