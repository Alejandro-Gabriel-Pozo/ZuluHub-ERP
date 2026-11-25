import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));

const { exigirAcceso, agregar, verificar, activar, desactivar, retirar } = vi.hoisted(() => ({
  exigirAcceso: vi.fn(),
  agregar: vi.fn(),
  verificar: vi.fn(),
  activar: vi.fn(),
  desactivar: vi.fn(),
  retirar: vi.fn(),
}));

vi.mock("../../apps/plataforma/servidor/acceso", () => ({ exigirAcceso }));

import {
  activarDominioDeConsola,
  agregarDominioDeConsola,
  desactivarDominioDeConsola,
  retirarDominioDeConsola,
  verificarDominioDeConsola,
} from "../../apps/plataforma/servidor/acciones-dominios";
import { MENSAJES_DE_ERROR_DE_DOMINIOS } from "../../src/plataforma/casos-de-uso/mensajes-de-dominios";

/**
 * Las acciones de la pantalla Dominios (la frontera entre el navegador y los casos de uso): `exigirAcceso` y los casos van simulados. Se prueba lo que la acción garantiza: pasa la clave del
 * navegador tal cual, el dueño del host es SIEMPRE la empresa elegida y nunca canónico (el navegador no puede pedir un host de marca), la fecha de verificación la pone el servidor
 * (inicio del día argentino), traduce los errores con el contexto de dominios, relanza la redirección de Next y no deja entrar entradas inválidas.
 */

const CLAVE = "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8a0b1c3d";
const DOMINIO = "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a";
const EMPRESA = "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0b";

const ALTA = {
  claveDeIdempotencia: CLAVE,
  empresaId: EMPRESA,
  host: "app.hotel.com.ar",
  superficie: "APP",
  titular: "CLIENTE",
};
const CAMBIO = { claveDeIdempotencia: CLAVE, dominioId: DOMINIO };

const redireccion = () =>
  Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/ingreso;307;" });

let registro: MockInstance<(...datos: unknown[]) => void>;

beforeEach(() => {
  for (const f of [exigirAcceso, agregar, verificar, activar, desactivar, retirar]) f.mockReset();
  exigirAcceso.mockResolvedValue({
    casos: {
      agregarDominio: agregar,
      verificarDominio: verificar,
      activarDominio: activar,
      desactivarDominio: desactivar,
      retirarDominio: retirar,
    },
  });
  agregar.mockResolvedValue({ ok: true, valor: { dominioId: DOMINIO, yaExistia: false } });
  for (const f of [verificar, activar, desactivar, retirar]) {
    f.mockResolvedValue({
      ok: true,
      valor: { dominioId: DOMINIO, estado: "VERIFICADO", yaEstaba: false },
    });
  }
  registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  registro.mockRestore();
  vi.useRealTimers();
});

describe("agregarDominioDeConsola", () => {
  it("camino feliz: el dueño es la empresa elegida, nunca canónico, con la clave del navegador", async () => {
    expect(
      await agregarDominioDeConsola({
        ...ALTA,
        esCanonico: true,
        duenio: { tipo: "MARCA", marcaId: "x" },
      }),
    ).toEqual({
      ok: true,
      dato: { dominioId: DOMINIO, yaEstaba: false },
    });
    expect(agregar).toHaveBeenCalledTimes(1);
    expect(agregar).toHaveBeenCalledWith({
      claveDeIdempotencia: CLAVE,
      host: "app.hotel.com.ar",
      superficie: "APP",
      titular: "CLIENTE",
      esCanonico: false,
      duenio: { tipo: "EMPRESA", empresaId: EMPRESA },
    });
  });

  it("clic doble: la MISMA clave llega al caso las dos veces y el resultado es el mismo", async () => {
    const [a, b] = await Promise.all([
      agregarDominioDeConsola(ALTA),
      agregarDominioDeConsola(ALTA),
    ]);
    expect(a).toEqual(b);
    expect(
      agregar.mock.calls.map(([p]) => (p as { claveDeIdempotencia: string }).claveDeIdempotencia),
    ).toEqual([CLAVE, CLAVE]);
  });

  it("repetir un alta ya hecha dice que ya estaba, sin error", async () => {
    agregar.mockResolvedValue({ ok: true, valor: { dominioId: DOMINIO, yaExistia: true } });
    expect(await agregarDominioDeConsola(ALTA)).toEqual({
      ok: true,
      dato: { dominioId: DOMINIO, yaEstaba: true },
    });
  });

  it("el nombre repetido sale en el campo del nombre con el texto del caso, sin el código", async () => {
    agregar.mockResolvedValue({ ok: false, error: "HOST_DUPLICADO" });
    const r = await agregarDominioDeConsola(ALTA);
    expect(r).toEqual({
      ok: false,
      error: { tipo: "CAMPO", campo: "host", texto: MENSAJES_DE_ERROR_DE_DOMINIOS.HOST_DUPLICADO },
    });
    expect(JSON.stringify(r)).not.toContain("HOST_DUPLICADO");
  });

  it("entradas inválidas (superficie fuera de la lista, sin empresa, sin clave) no llegan al caso", async () => {
    for (const mala of [
      { ...ALTA, superficie: "SITIO" },
      { ...ALTA, empresaId: "x" },
      { ...ALTA, claveDeIdempotencia: "x" },
      null,
      "texto",
    ]) {
      expect(await agregarDominioDeConsola(mala)).toEqual({
        ok: false,
        error: { tipo: "GENERAL", texto: "Los datos no son válidos. Revisalos." },
      });
    }
    expect(exigirAcceso).not.toHaveBeenCalled();
    expect(agregar).not.toHaveBeenCalled();
  });

  it("sin permiso: la acción se oculta; segundo factor: se devuelve tal cual sin registrar una falla", async () => {
    agregar.mockResolvedValueOnce({ ok: false, error: "SIN_PERMISO" });
    expect(await agregarDominioDeConsola(ALTA)).toEqual({
      ok: false,
      error: { tipo: "OCULTAR_ACCION" },
    });
    agregar.mockResolvedValueOnce({ ok: false, error: "segundo_factor_reciente_requerido" });
    expect(await agregarDominioDeConsola(ALTA)).toEqual({
      ok: false,
      error: { tipo: "SEGUNDO_FACTOR" },
    });
    expect(registro).not.toHaveBeenCalled();
  });

  it("lo inesperado sale con una referencia, sin datos del pedido, y queda en el registro", async () => {
    agregar.mockRejectedValue(new Error("falló la base con app.hotel.com.ar"));
    const r = await agregarDominioDeConsola(ALTA);
    expect(r).toMatchObject({ ok: false, error: { tipo: "INESPERADO" } });
    expect(JSON.stringify(r)).not.toContain("app.hotel.com.ar");
    expect(registro).toHaveBeenCalled();
  });

  it("la redirección de Next se relanza (no es una falla)", async () => {
    exigirAcceso.mockRejectedValue(redireccion());
    await expect(agregarDominioDeConsola(ALTA)).rejects.toThrow("NEXT_REDIRECT");
    expect(registro).not.toHaveBeenCalled();
  });
});

describe("verificarDominioDeConsola", () => {
  it("la fecha de verificación la pone el servidor: el inicio del día argentino, sin importar lo que mande el navegador", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-26T01:30:00.000Z"));
    await verificarDominioDeConsola({ ...CAMBIO, verificadoEn: "2030-01-01T00:00:00.000Z" });
    expect(verificar).toHaveBeenCalledWith({
      ...CAMBIO,
      verificadoEn: new Date("2026-11-25T03:00:00.000Z"),
    });
  });

  it("el reintento del mismo día manda la misma fecha (la clave repetida no se rechaza por distinta huella)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"));
    await verificarDominioDeConsola(CAMBIO);
    vi.setSystemTime(new Date("2026-11-25T23:00:00.000Z"));
    await verificarDominioDeConsola(CAMBIO);
    const fechas = verificar.mock.calls.map(([p]) =>
      (p as { verificadoEn: Date }).verificadoEn.toISOString(),
    );
    expect(fechas).toEqual(["2026-11-25T03:00:00.000Z", "2026-11-25T03:00:00.000Z"]);
  });

  it("rechaza un dominio con forma inválida sin llamar al caso", async () => {
    expect(
      await verificarDominioDeConsola({ claveDeIdempotencia: CLAVE, dominioId: "x" }),
    ).toMatchObject({ ok: false });
    expect(verificar).not.toHaveBeenCalled();
  });
});

describe("activar, desactivar y retirar", () => {
  it("activar y desactivar pasan clave y dominio, y devuelven si ya estaba", async () => {
    activar.mockResolvedValue({
      ok: true,
      valor: { dominioId: DOMINIO, estado: "ACTIVO", yaEstaba: true },
    });
    expect(await activarDominioDeConsola(CAMBIO)).toEqual({
      ok: true,
      dato: { dominioId: DOMINIO, yaEstaba: true },
    });
    expect(activar).toHaveBeenCalledWith(CAMBIO);
    expect(await desactivarDominioDeConsola(CAMBIO)).toMatchObject({ ok: true });
    expect(desactivar).toHaveBeenCalledWith(CAMBIO);
  });

  it("el estado que ya cambió (pantalla vieja) sale con el texto del caso", async () => {
    activar.mockResolvedValue({ ok: false, error: "TRANSICION_DE_DOMINIO_INVALIDA" });
    expect(await activarDominioDeConsola(CAMBIO)).toEqual({
      ok: false,
      error: {
        tipo: "GENERAL",
        texto: MENSAJES_DE_ERROR_DE_DOMINIOS.TRANSICION_DE_DOMINIO_INVALIDA,
      },
    });
  });

  it("retirar manda el motivo; sin motivo el caso responde y el error sale en el campo del motivo", async () => {
    expect(await retirarDominioDeConsola({ ...CAMBIO, motivo: "se fue" })).toMatchObject({
      ok: true,
    });
    expect(retirar).toHaveBeenCalledWith({ ...CAMBIO, motivo: "se fue" });
    retirar.mockResolvedValue({ ok: false, error: "MOTIVO_OBLIGATORIO" });
    expect(await retirarDominioDeConsola({ ...CAMBIO, motivo: "" })).toEqual({
      ok: false,
      error: {
        tipo: "CAMPO",
        campo: "motivo",
        texto: MENSAJES_DE_ERROR_DE_DOMINIOS.MOTIVO_OBLIGATORIO,
      },
    });
  });

  it("retirar sin motivo de texto ni llega al caso", async () => {
    expect(await retirarDominioDeConsola(CAMBIO)).toMatchObject({ ok: false });
    expect(retirar).not.toHaveBeenCalled();
  });
});
