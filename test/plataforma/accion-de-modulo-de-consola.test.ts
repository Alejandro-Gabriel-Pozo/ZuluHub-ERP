import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));

const { exigirAcceso, activarModuloDeEmpresa, desactivarModuloDeEmpresa } = vi.hoisted(() => ({
  activarModuloDeEmpresa: vi.fn(),
  desactivarModuloDeEmpresa: vi.fn(),
  exigirAcceso: vi.fn(),
}));

vi.mock("../../apps/plataforma/servidor/acceso", () => ({ exigirAcceso }));

import { cambiarModuloDeConsola } from "../../apps/plataforma/servidor/acciones-modulos";

/** La acción del servidor de activar y desactivar módulos: `exigirAcceso` y los casos de uso van simulados. */

const ENTRADA = {
  claveDeIdempotencia: "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8a0b1c3d",
  empresaId: "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a",
  modulo: "salon",
  activar: true,
};
const PEDIDO = {
  claveDeIdempotencia: ENTRADA.claveDeIdempotencia,
  empresaId: ENTRADA.empresaId,
  modulo: "salon",
};
const REDIRECCION = Object.assign(new Error("NEXT_REDIRECT"), {
  digest: "NEXT_REDIRECT;replace;/ingreso;307;",
});

let registro: MockInstance<(...datos: unknown[]) => void>;

beforeEach(() => {
  exigirAcceso.mockReset();
  activarModuloDeEmpresa.mockReset();
  desactivarModuloDeEmpresa.mockReset();
  exigirAcceso.mockResolvedValue({
    casos: { activarModuloDeEmpresa, desactivarModuloDeEmpresa },
  });
  activarModuloDeEmpresa.mockResolvedValue({ ok: true, valor: { yaEstabaActivo: false } });
  desactivarModuloDeEmpresa.mockResolvedValue({ ok: true, valor: { yaEstabaInactivo: true } });
  registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  registro.mockRestore();
});

describe("cambiarModuloDeConsola", () => {
  it("activar llama al caso de activar con la misma clave y devuelve «ya estaba»", async () => {
    expect(await cambiarModuloDeConsola(ENTRADA)).toEqual({ ok: true, dato: { yaEstaba: false } });
    expect(activarModuloDeEmpresa).toHaveBeenCalledWith(PEDIDO);
    expect(desactivarModuloDeEmpresa).not.toHaveBeenCalled();
  });

  it("desactivar llama al caso de desactivar con la misma clave", async () => {
    const r = await cambiarModuloDeConsola({ ...ENTRADA, activar: false });
    expect(r).toEqual({ ok: true, dato: { yaEstaba: true } });
    expect(desactivarModuloDeEmpresa).toHaveBeenCalledWith(PEDIDO);
    expect(activarModuloDeEmpresa).not.toHaveBeenCalled();
  });

  it("sin sesión de administrador (la redirección) no llama a ningún caso y se relanza", async () => {
    exigirAcceso.mockRejectedValue(REDIRECCION);
    await expect(cambiarModuloDeConsola(ENTRADA)).rejects.toBe(REDIRECCION);
    expect(activarModuloDeEmpresa).not.toHaveBeenCalled();
    expect(desactivarModuloDeEmpresa).not.toHaveBeenCalled();
    expect(registro).not.toHaveBeenCalled();
  });

  it.each([
    null,
    "texto",
    { ...ENTRADA, claveDeIdempotencia: "x" },
    { ...ENTRADA, modulo: "inventado" },
    { ...ENTRADA, activar: "si" },
  ])("forma inválida (%j): datos no válidos y no llama a nada", async (entrada) => {
    expect(await cambiarModuloDeConsola(entrada)).toEqual({
      ok: false,
      error: { tipo: "GENERAL", texto: "Los datos no son válidos. Revisalos." },
    });
    expect(exigirAcceso).not.toHaveBeenCalled();
  });

  it("un rechazo del caso de uso llega traducido, con el módulo que falta", async () => {
    activarModuloDeEmpresa.mockResolvedValue({
      ok: false,
      error: { codigo: "REQUIERE_INACTIVO", modulo: "comandas" },
    });
    expect(await cambiarModuloDeConsola(ENTRADA)).toEqual({
      ok: false,
      error: { tipo: "GENERAL", texto: "Primero hay que activar Comandas." },
    });
  });

  it("una falla inesperada da referencia PD-… y el registro no lleva ids ni la clave", async () => {
    desactivarModuloDeEmpresa.mockRejectedValue(new Error("se cayó la conexión"));
    const r = await cambiarModuloDeConsola({ ...ENTRADA, activar: false });
    expect(r).toMatchObject({ ok: false, error: { tipo: "INESPERADO" } });
    expect(r.ok === false && r.referencia).toMatch(/^PD-/);
    const escrito = JSON.stringify(registro.mock.calls);
    expect(escrito).not.toContain(ENTRADA.empresaId);
    expect(escrito).not.toContain(ENTRADA.claveDeIdempotencia);
  });
});
