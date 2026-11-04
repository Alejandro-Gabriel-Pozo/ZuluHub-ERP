import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));

const { exigirAcceso, asignarPlan, orden } = vi.hoisted(() => ({
  orden: [] as string[],
  asignarPlan: vi.fn(),
  exigirAcceso: vi.fn(),
}));

vi.mock("../../apps/plataforma/servidor/acceso", () => ({ exigirAcceso }));

import { cambiarPlanDeConsola } from "../../apps/plataforma/servidor/acciones-plan";

/**
 * La acción del servidor del cambio de plan (frontera entre el navegador y el caso de uso): `exigirAcceso` y el
 * caso de uso van simulados. Se prueba lo que la acción garantiza: autoriza antes de operar, deja pasar la
 * redirección de Next, no deja entrar entradas inválidas y no escribe el pedido en el registro del servidor.
 */

const MOTIVO = "Pasa al plan Pro por pedido del cliente";

const ENTRADA = {
  claveDeIdempotencia: "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8a0b1c3d",
  tenantId: "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a",
  versionDePlanId: "11111111-1111-4111-8111-111111111111",
  vigenteDesde: "2026-11-01",
  motivo: MOTIVO,
  numeroEsperado: 3,
  reemplazaProgramada: false,
};

const REDIRECCION = Object.assign(new Error("NEXT_REDIRECT"), {
  digest: "NEXT_REDIRECT;replace;/ingreso;307;",
});

let registro: MockInstance<(...datos: unknown[]) => void>;

beforeEach(() => {
  orden.length = 0;
  exigirAcceso.mockReset();
  asignarPlan.mockReset();
  exigirAcceso.mockImplementation(() => {
    orden.push("exigirAcceso");
    return Promise.resolve({ casos: { asignarPlan } });
  });
  asignarPlan.mockImplementation(() => {
    orden.push("asignarPlan");
    return Promise.resolve({ ok: true, valor: { numero: 4, yaExistia: false } });
  });
  registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  registro.mockRestore();
});

describe("cambiarPlanDeConsola", () => {
  it("camino feliz: autoriza primero y llama al caso con la clave y la fecha del navegador", async () => {
    const r = await cambiarPlanDeConsola(ENTRADA);
    expect(r).toEqual({ ok: true, dato: { numero: 4, yaExistia: false } });
    expect(orden).toEqual(["exigirAcceso", "asignarPlan"]);
    expect(asignarPlan).toHaveBeenCalledWith({
      claveDeIdempotencia: ENTRADA.claveDeIdempotencia,
      tenantId: ENTRADA.tenantId,
      versionDePlanId: ENTRADA.versionDePlanId,
      vigenteDesde: new Date("2026-11-01T03:00:00.000Z"),
      motivo: MOTIVO,
      numeroEsperado: 3,
      reemplazaProgramada: false,
    });
  });

  it("NEXT_REDIRECT de `exigirAcceso` se relanza tal cual: el caso no corre y no se registra", async () => {
    exigirAcceso.mockImplementation(() => {
      orden.push("exigirAcceso");
      return Promise.reject(REDIRECCION);
    });
    await expect(cambiarPlanDeConsola(ENTRADA)).rejects.toBe(REDIRECCION);
    expect(orden).toEqual(["exigirAcceso"]);
    expect(asignarPlan).not.toHaveBeenCalled();
    expect(registro).not.toHaveBeenCalled();
  });

  it("NEXT_REDIRECT lanzado por el caso de uso también se relanza", async () => {
    asignarPlan.mockRejectedValue(REDIRECCION);
    await expect(cambiarPlanDeConsola(ENTRADA)).rejects.toBe(REDIRECCION);
    expect(registro).not.toHaveBeenCalled();
  });

  it("un error con digest que NO es de redirección se traduce a INESPERADO con referencia", async () => {
    exigirAcceso.mockRejectedValue(Object.assign(new Error("otra cosa"), { digest: "OTRO;x" }));
    const r = await cambiarPlanDeConsola(ENTRADA);
    expect(r).toMatchObject({ ok: false, error: { tipo: "INESPERADO" } });
    expect(r.ok === false && r.referencia).toMatch(/^PD-/);
  });

  it.each([
    null,
    undefined,
    "texto",
    [],
    { ...ENTRADA, claveDeIdempotencia: "no-es-uuid" },
    { ...ENTRADA, vigenteDesde: "2026-02-30" },
    { ...ENTRADA, motivo: "   " },
    { ...ENTRADA, motivo: "a".repeat(501) },
    { ...ENTRADA, numeroEsperado: 0 },
  ])("entrada inválida (%j): datos no válidos y no llama a nada", async (entrada) => {
    const r = await cambiarPlanDeConsola(entrada);
    expect(r).toEqual({
      ok: false,
      error: { tipo: "GENERAL", texto: "Los datos no son válidos. Revisalos." },
    });
    expect(exigirAcceso).not.toHaveBeenCalled();
    expect(asignarPlan).not.toHaveBeenCalled();
  });

  it("una falla inesperada del caso: referencia PD-… y el registro no lleva el motivo ni los ids del pedido", async () => {
    asignarPlan.mockRejectedValue(new Error("se cayó la conexión"));
    const r = await cambiarPlanDeConsola(ENTRADA);
    expect(r).toMatchObject({ ok: false, error: { tipo: "INESPERADO" } });
    expect(registro).toHaveBeenCalledTimes(1);
    const escrito = JSON.stringify(registro.mock.calls);
    expect(escrito).toContain("se cayó la conexión");
    expect(escrito).not.toContain(MOTIVO);
    expect(escrito).not.toContain(ENTRADA.tenantId);
    expect(escrito).not.toContain(ENTRADA.versionDePlanId);
    expect(JSON.stringify(r)).not.toContain(MOTIVO);
  });

  it("un error inesperado devuelto como valor también se registra sin el pedido", async () => {
    asignarPlan.mockResolvedValue({ ok: false, error: { tipo: "Inesperado", mensaje: "falla" } });
    const r = await cambiarPlanDeConsola(ENTRADA);
    expect(r).toMatchObject({ ok: false, error: { tipo: "INESPERADO" } });
    const escrito = JSON.stringify(registro.mock.calls);
    expect(escrito).not.toContain(MOTIVO);
    expect(escrito).not.toContain(ENTRADA.tenantId);
  });

  it("un rechazo de negocio se traduce con el contexto del plan y no se registra", async () => {
    asignarPlan.mockResolvedValue({ ok: false, error: "TENANT_NO_ENCONTRADO" });
    const r = await cambiarPlanDeConsola(ENTRADA);
    expect(r).toMatchObject({ ok: false, error: { tipo: "PANTALLA_VIEJA" } });
    expect(registro).not.toHaveBeenCalled();
  });

  it("el cambio programado pendiente apunta a la casilla (error general con texto propio)", async () => {
    asignarPlan.mockResolvedValue({ ok: false, error: "CAMBIO_PROGRAMADO_PENDIENTE" });
    const r = await cambiarPlanDeConsola(ENTRADA);
    expect(r).toMatchObject({ ok: false, error: { tipo: "GENERAL" } });
  });
});
